"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchCarpool, postCarpool } from "./carpoolFetch";
import { useActor } from "./useActor";
import { useToast } from "./Toast";
import ActorModal from "./ActorModal";
import CarpoolHeader from "./CarpoolHeader";
import type { ClubDTO, EventDTO, MemberDTO } from "@/lib/carpool/api/mappers";
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
  const { actorName, ready, setActor } = useActor(slug);

  const [club, setClub] = useState<ClubDTO | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [members, setMembers] = useState<MemberDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showActorModal, setShowActorModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);

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

  const openEventModal = () => {
    if (ready && !actorName) {
      setShowActorModal(true);
      return;
    }
    setShowEventModal(true);
  };

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
    if (!actorName) {
      setShowActorModal(true);
      return;
    }
    setCreatingId(joe.joeEventId);
    setCreateError(null);
    try {
      const data = await postCarpool<{ event: EventDTO }>(`/clubs/${slug}/events`, {
        actorName,
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
                マスタ設定
              </Link>
            </footer>
          </>
        )}
      </main>

      {showActorModal && (
        <ActorModal
          slug={slug}
          members={members}
          onSelect={(name) => {
            setActor(name);
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
              会場と駐車場が分かれる大会は要綱で確認して到着地ノードを変更してください。
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
