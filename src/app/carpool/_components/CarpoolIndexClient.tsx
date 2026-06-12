"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fetchCarpool, postCarpool } from "./carpoolFetch";
import { useToast } from "./Toast";
import { actorStorageKey, readRememberedClub, rememberClub } from "./storageKeys";
import type { ClubDTO } from "@/lib/carpool/api/mappers";

export default function CarpoolIndexClient() {
  const router = useRouter();
  const { toast, toastEl } = useToast();

  const [clubs, setClubs] = useState<ClubDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  // 追加フォーム
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [joeNames, setJoeNames] = useState("");
  const [actorName, setActorName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // クラブ記憶の読込 + 自動遷移（04 §0）。?stay=1 で自動遷移を抑止
  //（CarpoolHeader の「別のクラブを選ぶ」リンクは ?stay=1 付きで来る）。
  useEffect(() => {
    const stored = readRememberedClub();
    if (!stored) return;
    setSavedSlug(stored);
    const stay = new URLSearchParams(window.location.search).has("stay");
    if (!stay) {
      setRedirecting(true);
      router.replace(`/carpool/${stored}`);
    }
  }, [router]);

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
      const data = await postCarpool<{ club: ClubDTO }>("/clubs", {
        actorName: trimmedActor,
        name: name.trim(),
        slug: slug.trim(),
        joeClubNames,
      });
      toast("クラブを作成しました", "success");
      // 作成者の操作者名をそのクラブに引き継ぐ
      try {
        window.localStorage.setItem(actorStorageKey(data.club.slug), trimmedActor);
      } catch {
        /* noop */
      }
      selectClub(data.club.slug);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "作成に失敗しました");
      setSubmitting(false);
    }
  };

  if (redirecting) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <p className="text-sm text-muted">前回のクラブへ移動中…</p>
      </main>
    );
  }

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
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted" htmlFor="club-slug">
                slug（英小文字・数字・ハイフン）
              </label>
              <input
                id="club-slug"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                pattern="[a-z0-9][a-z0-9\-]*"
                minLength={2}
                maxLength={40}
                required
              />
            </div>
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
                onChange={(e) => setActorName(e.target.value)}
                maxLength={30}
                required
              />
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
