"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchCarpool, postCarpool } from "./carpoolFetch";
import { useActor } from "./useActor";
import { useToast } from "./Toast";
import ActorModal from "./ActorModal";
import CarpoolHeader from "./CarpoolHeader";
import { cn } from "@/lib/utils";
import type {
  ClubDTO,
  EventDTO,
  MemberDTO,
  ParticipationDTO,
} from "@/lib/carpool/api/mappers";
import type { JoyEvent as JoyEventLike } from "./carpoolTypes";

interface CarpoolHomeClientProps {
  slug: string;
}

const STATUS_LABEL: Record<EventDTO["status"], string> = {
  planning: "募集中",
  provisional: "暫定公開",
  final: "確定公開",
  closed: "終了",
};

const STATUS_CLASS: Record<EventDTO["status"], string> = {
  planning: "bg-blue-500/20 text-blue-400",
  provisional: "bg-yellow-500/20 text-yellow-400",
  final: "bg-green-500/20 text-green-400",
  closed: "bg-white/10 text-muted",
};

function formatEventDate(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function CarpoolHomeClient({ slug }: CarpoolHomeClientProps) {
  const router = useRouter();
  const { toast, toastEl } = useToast();

  const [club, setClub] = useState<ClubDTO | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [members, setMembers] = useState<MemberDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { actorName, actorMemberId, ready, setActorMember } = useActor(slug, members);

  const [showActorModal, setShowActorModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);

  // 直近イベントの自分の参加有無（Step4 判定用）。null=未取得 / 判定不能。
  const [latestParticipated, setLatestParticipated] = useState<boolean | null>(null);

  // イベント検索モーダル
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<JoyEventLike[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [clubRes, eventsRes, membersRes] = await Promise.all([
          fetchCarpool<{ club: ClubDTO }>(`/clubs/${slug}`),
          fetchCarpool<{ events: EventDTO[] }>(`/clubs/${slug}/events`),
          fetchCarpool<{ members: MemberDTO[] }>(`/clubs/${slug}/members`),
        ]);
        if (cancelled) return;
        setClub(clubRes.club);
        setEvents(
          [...eventsRes.events].sort((a, b) => b.eventDate.localeCompare(a.eventDate)),
        );
        setMembers(membersRes.members);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Step4 判定: 直近イベント（events[0]）の participations を 1 本だけ追加 fetch し、
  // actorMember の参加有無を見る。actorMember 未設定や直近イベント無しなら判定不能（null）。
  useEffect(() => {
    let cancelled = false;
    const latest = events[0];
    if (!latest || !actorMemberId) {
      setLatestParticipated(null);
      return;
    }
    (async () => {
      try {
        const res = await fetchCarpool<{ participations: ParticipationDTO[] }>(
          `/clubs/${slug}/events/${latest.id}/participations`,
        );
        if (cancelled) return;
        setLatestParticipated(
          res.participations.some((p) => p.memberId === actorMemberId),
        );
      } catch {
        if (!cancelled) setLatestParticipated(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, events, actorMemberId]);

  const openEventModal = () => {
    setShowEventModal(true);
  };

  const copyShareUrl = async () => {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/carpool/${slug}`
        : `/carpool/${slug}`;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        toast("URL をコピーしました", "success");
        return;
      }
      throw new Error("clipboard unavailable");
    } catch {
      // clipboard 不可環境は URL 文字列を toast で表示（手動コピー用）。
      toast(url, "success");
    }
  };

  // セットアップ状態の各ステップ完了判定。
  const setup = useMemo(() => {
    const step1Done = actorMemberId !== null; // あなたを登録
    const step2Done = events.length > 0; // 大会を選ぶ
    const step3Done = members.length > 1; // クラブに共有（自分以外もいる）
    // M3: イベント0件なら Step4 は「配車係待ち」の待機表示であり、完了判定の対象外。
    const step4Required = events.length > 0;
    // Step4 は直近イベント + actorMember の参加有無。判定不能なら未完了扱いにしない（非活性）。
    const step4Known = step1Done && step4Required && latestParticipated !== null;
    const step4Done = step4Known && latestParticipated === true;
    const allDone =
      step1Done && step2Done && step3Done && (!step4Required || step4Done);
    return { step1Done, step2Done, step3Done, step4Required, step4Known, step4Done, allDone };
  }, [actorMemberId, events.length, members.length, latestParticipated]);

  const latestEvent = events[0];

  const runSearch = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const data = await fetchCarpool<{ events: JoyEventLike[] }>(
        `/events-search?q=${encodeURIComponent(q)}`,
      );
      setResults(data.events);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "検索に失敗しました");
    } finally {
      setSearching(false);
    }
  };

  const createEvent = async (joe: JoyEventLike) => {
    // actorName は member 解決後の display_name。未解決でも作成は可能だが、
    // 設定済みなら正しい操作者名を残す。
    setCreatingId(joe.joeEventId);
    setCreateError(null);
    try {
      const data = await postCarpool<{ event: EventDTO }>(`/clubs/${slug}/events`, {
        actorName: actorName ?? "（未設定）",
        joeEventId: joe.joeEventId,
      });
      toast("配車イベントを作成しました", "success");
      router.push(`/carpool/${slug}/${data.event.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "作成に失敗しました");
      setCreatingId(null);
    }
  };

  return (
    <div className="min-h-screen">
      {toastEl}
      <CarpoolHeader
        clubName={club?.name ?? slug}
        slug={slug}
        actorName={actorName}
        onActorChange={() => setShowActorModal(true)}
      />

      <main className="mx-auto max-w-2xl px-4 py-6">
        {loading && <p className="text-sm text-muted">読み込み中…</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}

        {!loading && !error && (
          <>
            {ready && !setup.allDone && (
              <section className="mb-6 rounded-xl border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">
                  はじめの設定
                </h2>
                <ol className="flex flex-col gap-2">
                  <SetupStep
                    n={1}
                    title="あなたを登録する"
                    done={setup.step1Done}
                    cta={
                      !setup.step1Done
                        ? {
                            label: "登録する",
                            onClick: () => setShowActorModal(true),
                          }
                        : undefined
                    }
                  />
                  <SetupStep
                    n={2}
                    title="配車する大会を選ぶ"
                    done={setup.step2Done}
                    cta={
                      !setup.step2Done
                        ? { label: "大会を選ぶ", onClick: openEventModal }
                        : undefined
                    }
                  />
                  <SetupStep
                    n={3}
                    title="クラブのみんなに URL を共有する"
                    done={setup.step3Done}
                    cta={
                      !setup.step3Done
                        ? { label: "URL をコピー", onClick: () => void copyShareUrl() }
                        : undefined
                    }
                  />
                  <SetupStep
                    n={4}
                    title="参加を登録する"
                    done={setup.step4Done}
                    // Step1 未完了 or 直近イベント無しなら判定不能 → 非活性表示。
                    disabled={!setup.step1Done || !latestEvent}
                    // M3: イベント0件の初見メンバーでも導線が尽きないよう待機表示を出す。
                    note={
                      !latestEvent
                        ? "配車係が大会を作るのを待っています（作られるとここから参加登録できます）"
                        : undefined
                    }
                    cta={
                      setup.step1Done && latestEvent && !setup.step4Done
                        ? {
                            label: "参加を登録",
                            href: `/carpool/${slug}/${latestEvent.id}`,
                          }
                        : undefined
                    }
                  />
                </ol>
              </section>
            )}

            <div className="mb-4 flex items-center justify-between gap-2">
              <h1 className="text-lg font-bold text-foreground">配車イベント</h1>
              <button
                type="button"
                onClick={openEventModal}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
              >
                配車イベントを作る
              </button>
            </div>

            <ul className="flex flex-col gap-2">
              {events.map((ev) => (
                <li key={ev.id}>
                  <Link
                    href={`/carpool/${slug}/${ev.id}`}
                    className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-4 hover:bg-card-hover"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {ev.name}
                      </p>
                      <p className="text-xs text-muted">{formatEventDate(ev.eventDate)}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${STATUS_CLASS[ev.status]}`}
                    >
                      {STATUS_LABEL[ev.status]}
                    </span>
                  </Link>
                </li>
              ))}
              {events.length === 0 && (
                <li className="text-sm text-muted">まだ配車イベントがありません。</li>
              )}
            </ul>

            <footer className="mt-8 flex flex-wrap gap-3 border-t border-border pt-4">
              <Link
                href={`/carpool/${slug}/members`}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm text-foreground hover:bg-white/15"
              >
                メンバー管理
              </Link>
              <Link
                href={`/carpool/${slug}/masters`}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm text-foreground hover:bg-white/15"
              >
                ⚙ 設定
              </Link>
            </footer>
          </>
        )}
      </main>

      {showActorModal && (
        <ActorModal
          slug={slug}
          members={members}
          actorName={actorName}
          onSelectMember={(m) => {
            setActorMember(m);
            setMembers((prev) =>
              prev.some((x) => x.id === m.id) ? prev : [...prev, m],
            );
            setShowActorModal(false);
          }}
          onClose={() => setShowActorModal(false)}
        />
      )}

      {showEventModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowEventModal(false)}
        >
          <div
            className="mx-4 max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-xl bg-card p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className="mb-2 text-base font-semibold text-foreground">大会を検索</h2>
            <form onSubmit={runSearch} className="mb-3 flex gap-2">
              <input
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                placeholder="大会名で検索"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              <button
                type="submit"
                disabled={searching || !query.trim()}
                className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
              >
                検索
              </button>
            </form>

            <p className="mb-3 rounded-lg bg-surface p-2 text-xs text-muted">
              会場と駐車場が分かれる大会は、要綱を見て「会場・駐車場」の場所を確認・修正してください（⚙ 設定 から変更できます）。
            </p>

            {searchError && <p className="mb-2 text-sm text-red-400">{searchError}</p>}
            {createError && <p className="mb-2 text-sm text-red-400">{createError}</p>}

            <ul className="flex flex-col gap-2">
              {results.map((r) => (
                <li
                  key={r.joeEventId}
                  className="rounded-lg border border-border bg-surface p-3"
                >
                  <p className="text-sm font-medium text-foreground">{r.name}</p>
                  <p className="text-xs text-muted">
                    {formatEventDate(r.date)}
                    {r.venue ? ` ・ ${r.venue}` : ""}
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => createEvent(r)}
                      disabled={creatingId === r.joeEventId}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-dark disabled:opacity-50"
                    >
                      {creatingId === r.joeEventId ? "作成中…" : "選択"}
                    </button>
                    {r.joeUrl && (
                      <a
                        href={r.joeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-accent hover:underline"
                      >
                        JOY を開く
                      </a>
                    )}
                  </div>
                </li>
              ))}
              {!searching && results.length === 0 && query.trim() && !searchError && (
                <li className="text-sm text-muted">該当する大会がありません。</li>
              )}
            </ul>

            <button
              type="button"
              onClick={() => setShowEventModal(false)}
              className="mt-4 w-full rounded-lg bg-white/10 px-4 py-2 text-sm text-foreground hover:bg-white/15"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** セットアップガイドの 1 ステップ行。完了は ✓、未完了は CTA ボタン/リンクを出す。 */
function SetupStep({
  n,
  title,
  done,
  cta,
  disabled,
  note,
}: {
  n: number;
  title: string;
  done: boolean;
  cta?: { label: string; onClick?: () => void; href?: string };
  disabled?: boolean;
  /** 待機状態などの補足表示（タイトル下・任意）。 */
  note?: string;
}) {
  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2",
        disabled && "opacity-50",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
            done ? "bg-green-500/20 text-green-400" : "bg-white/10 text-muted",
          )}
        >
          {done ? "✓" : n}
        </span>
        <span className="min-w-0">
          <span
            className={cn(
              "block truncate text-sm",
              done ? "text-muted line-through" : "text-foreground",
            )}
          >
            {title}
          </span>
          {note && <span className="block text-[10px] text-muted">{note}</span>}
        </span>
      </div>
      {!done && cta && (
        cta.href ? (
          <Link
            href={cta.href}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-dark"
          >
            {cta.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={cta.onClick}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-dark"
          >
            {cta.label}
          </button>
        )
      )}
    </li>
  );
}
