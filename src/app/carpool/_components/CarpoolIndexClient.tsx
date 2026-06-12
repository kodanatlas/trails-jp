"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fetchCarpool, postCarpool, CarpoolApiError } from "./carpoolFetch";
import { useToast } from "./Toast";
import { useAthleteSuggest } from "./useAthleteSuggest";
import {
  actorStorageKey,
  rememberActorMember,
  readRememberedClub,
  rememberClub,
} from "./storageKeys";
import { filterClubCandidates, clubSelectionToFields } from "@/lib/carpool/suggest";
import { generateClubSlug, retryClubSlug } from "@/lib/carpool/club-slug";
import { buildCreatorMemberBody } from "@/lib/carpool/onboarding";
import type { ClubDTO, MemberDTO } from "@/lib/carpool/api/mappers";

export default function CarpoolIndexClient() {
  const router = useRouter();
  const { toast, toastEl } = useToast();

  const [clubs, setClubs] = useState<ClubDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);

  // 追加フォーム
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [joeNames, setJoeNames] = useState("");
  const [actorName, setActorName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // R2: slug は入力欄を廃止し、クラブ名から自動生成（決定的）。409 時は別サフィックスで1回リトライ。
  const clubSlug = useMemo(() => generateClubSlug(name), [name]);

  // R2: 「あなたの名前（記録用）」の氏名サジェスト（正規氏名を選ばせて M1 の member 化と整合）。
  const actorSuggest = useAthleteSuggest();
  const pickActorCandidate = (canonicalName: string) => {
    setActorName(canonicalName.trim());
    actorSuggest.dismiss();
  };

  // 指摘4: クラブ名の正規候補サジェスト。trails.jp 静的配信の /data/club-stats.json
  // （正規化済みクラブ名がキー）をフォーム表示時に1回 fetch し、キー一覧のみ保持する。
  // null = 未取得（取得失敗時もサジェスト無しで自由入力できる: ベストエフォート）。
  const [clubKeys, setClubKeys] = useState<string[] | null>(null);
  const [showClubSuggest, setShowClubSuggest] = useState(false);

  useEffect(() => {
    if (!showForm || clubKeys !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/data/club-stats.json", {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const json = (await res.json()) as { clubs?: Record<string, unknown> };
        if (!cancelled) setClubKeys(Object.keys(json.clubs ?? {}));
      } catch {
        /* サジェストはベストエフォート（失敗しても自由入力を妨げない） */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showForm, clubKeys]);

  const clubCandidates = useMemo(
    () => (showClubSuggest ? filterClubCandidates(clubKeys ?? [], name) : []),
    [showClubSuggest, clubKeys, name],
  );

  const pickClubCandidate = (canonicalClubName: string) => {
    const fields = clubSelectionToFields(canonicalClubName);
    setName(fields.name);
    setJoeNames(fields.joeClubNames.join(", "));
    setShowClubSuggest(false);
  };

  // クラブ記憶は「前回のクラブを開く」ショートカット表示にのみ使う。
  // 自動遷移はしない（特定クラブに表示が固定される挙動は 2026-06-12 ユーザー指示で廃止）。
  useEffect(() => {
    const stored = readRememberedClub();
    if (stored) setSavedSlug(stored);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchCarpool<{ clubs: ClubDTO[] }>("/clubs");
        if (!cancelled) setClubs(data.clubs);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectClub = (clubSlug: string) => {
    rememberClub(clubSlug);
    router.push(`/carpool/${clubSlug}`);
  };

  const goToSaved = () => {
    if (savedSlug) router.push(`/carpool/${savedSlug}`);
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedActor = actorName.trim();
    if (!trimmedActor) {
      setFormError("登録するあなたの名前を入力してください");
      return;
    }

    const joeClubNames = joeNames
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    setSubmitting(true);
    try {
      const createClub = (slugAttempt: string) =>
        postCarpool<{ club: ClubDTO }>("/clubs", {
          actorName: trimmedActor,
          name: name.trim(),
          slug: slugAttempt,
          joeClubNames,
        });

      // R2: 自動生成 slug で作成。409（重複）のときだけ別サフィックスで1回リトライ。
      let data: { club: ClubDTO };
      try {
        data = await createClub(clubSlug);
      } catch (err) {
        if (err instanceof CarpoolApiError && err.status === 409) {
          data = await createClub(retryClubSlug(clubSlug, String(Date.now())));
        } else {
          throw err;
        }
      }
      toast("クラブを作成しました", "success");

      // M1: 作成者をその場で member 化し、操作者（actorMember 新キー）として保存する。
      // 旧キーだけの名前書き込みは廃止（ホームで「未設定」になり Step1 で二重登録感が出るため）。
      // athleteKey は body に含めない = サーバが normalizeNameKey(displayName) を自動付与。
      const memberBody = buildCreatorMemberBody(trimmedActor);
      if (memberBody) {
        try {
          const created = await postCarpool<{ member: MemberDTO }>(
            `/clubs/${data.club.slug}/members`,
            memberBody,
          );
          // useActor.setActorMember 相当（新キー member_id + 互換旧キー名前）。
          rememberActorMember(data.club.slug, created.member);
        } catch {
          // member 化の失敗はクラブ作成の成功を妨げない（遷移は続行）。
          // 旧キーに名前だけ残し、ホーム Step1 の自己登録フォームが名前をプリフィルする。
          try {
            window.localStorage.setItem(actorStorageKey(data.club.slug), trimmedActor);
          } catch {
            /* noop */
          }
        }
      }

      selectClub(data.club.slug);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "作成に失敗しました");
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      {toastEl}
      <h1 className="mb-1 text-xl font-bold text-foreground">🚗 配車割</h1>
      <p className="mb-5 text-sm text-muted">クラブを選んでください。</p>

      {savedSlug && (
        <button
          type="button"
          onClick={goToSaved}
          className="mb-4 w-full rounded-xl border border-border bg-card p-3 text-left text-sm text-foreground hover:bg-card-hover"
        >
          前回のクラブ「{savedSlug}」を開く
        </button>
      )}

      {loading && <p className="text-sm text-muted">読み込み中…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && !error && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {clubs.map((club) => (
            <div
              key={club.id}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4"
            >
              <div>
                <p className="text-sm font-semibold text-foreground">{club.name}</p>
                <p className="text-xs text-muted">{club.slug}</p>
              </div>
              <button
                type="button"
                onClick={() => selectClub(club.slug)}
                className="mt-auto rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
              >
                選ぶ
              </button>
            </div>
          ))}
          {clubs.length === 0 && (
            <p className="text-sm text-muted">クラブがまだありません。下から追加できます。</p>
          )}
        </div>
      )}

      <section className="mt-8">
        {!showForm ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm text-foreground hover:bg-white/15"
          >
            ＋クラブを追加
          </button>
        ) : (
          <form
            onSubmit={handleCreate}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
          >
            <h2 className="text-sm font-semibold text-foreground">クラブを追加</h2>
            <div>
              <label className="mb-1 block text-xs text-muted" htmlFor="club-name">
                クラブ名
              </label>
              <input
                id="club-name"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setShowClubSuggest(true);
                }}
                maxLength={60}
                required
              />
              {clubCandidates.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1 rounded-lg bg-surface p-1">
                  {clubCandidates.map((c) => (
                    <li key={c}>
                      <button
                        type="button"
                        onClick={() => pickClubCandidate(c)}
                        className="w-full rounded px-2 py-1 text-left text-sm text-foreground hover:bg-card-hover"
                      >
                        {c}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[10px] text-muted">
                候補から選ぶと JOY エントリーの自動検出が確実になります（JOY 表記名も自動で入ります）。
              </p>
            </div>
            {/* R2: slug 入力欄は廃止（クラブ名から自動生成・手修正不要） */}
            {name.trim() && (
              <p className="rounded-lg bg-surface px-3 py-2 text-[10px] text-muted">
                URL: /carpool/{clubSlug}（クラブ名から自動生成されます）
              </p>
            )}
            <div>
              <label className="mb-1 block text-xs text-muted" htmlFor="club-joe">
                JOY クラブ表記名（カンマ区切り・任意）
              </label>
              <input
                id="club-joe"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                value={joeNames}
                onChange={(e) => setJoeNames(e.target.value)}
                placeholder="例: トレイルズOLC, trails"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted" htmlFor="club-actor">
                あなたの名前（記録用）
              </label>
              <input
                id="club-actor"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                value={actorName}
                onChange={(e) => {
                  setActorName(e.target.value);
                  actorSuggest.setQuery(e.target.value);
                }}
                maxLength={30}
                required
              />
              {actorSuggest.results.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1 rounded-lg bg-surface p-1">
                  {actorSuggest.results.map((a) => (
                    <li key={a.name}>
                      <button
                        type="button"
                        onClick={() => pickActorCandidate(a.name)}
                        className="w-full rounded px-2 py-1 text-left text-sm text-foreground hover:bg-card-hover"
                      >
                        {a.name}
                        {a.clubs.length > 0 && (
                          <span className="ml-2 text-xs text-muted">
                            {a.clubs.join(", ")}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[10px] text-muted">
                候補から選ぶと JOY エントリーの自動検出が確実になります（一覧に無ければそのまま入力でOK）。
              </p>
            </div>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
              >
                {submitting ? "作成中…" : "作成"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm text-foreground hover:bg-white/15"
              >
                キャンセル
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
