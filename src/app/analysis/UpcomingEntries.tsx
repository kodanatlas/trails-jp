"use client";

import { useMemo } from "react";
import { CalendarCheck, ExternalLink, Loader2 } from "lucide-react";
import type { AthleteEntryRef } from "@/lib/entries/index-types";

interface Props {
  /** null = 読み込み中。読み込み完了後は entries 配列（空可）。 */
  data: { entries: AthleteEntryRef[]; generatedAt: string | null } | null;
}

/** YYYY-MM-DD 同士の日数差（to - from）。UTC基準で整数日。 */
function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

/** 「最近の大会参加状況」(RecentEvents) の下に置く、出場予定（エントリー済）大会カード。 */
export function UpcomingEntries({ data }: Props) {
  // JST の今日
  const today = useMemo(() => {
    return new Date(new Date().getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }, []);

  // 念のため未開催のみに再フィルタ＋date昇順
  const upcoming = useMemo(() => {
    if (!data) return [];
    return [...data.entries]
      .filter((e) => e.date >= today)
      .sort(
        (a, b) => a.date.localeCompare(b.date) || a.eventName.localeCompare(b.eventName),
      );
  }, [data, today]);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      {/* ヘッダー */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            大会エントリー状況
          </span>
        </div>
        {data && upcoming.length > 0 && (
          <span className="text-xs text-muted">
            出場予定: <span className="font-bold text-foreground">{upcoming.length}</span> 大会
          </span>
        )}
      </div>

      {data === null ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="ml-2 text-xs text-muted">エントリー情報を読み込み中...</span>
        </div>
      ) : upcoming.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">
          現在エントリー予定の大会はありません
        </p>
      ) : (
        <div className="space-y-1.5">
          {upcoming.map((e) => {
            const daysLeft = daysBetween(today, e.date);
            const dt = new Date(e.date + "T00:00:00");
            const dateStr = `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
            return (
              <a
                key={`${e.joe_event_id}-${e.className}`}
                href={e.joeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded bg-surface p-2 transition-colors hover:bg-white/5"
              >
                {/* 日付 + カウントダウン */}
                <div className="w-16 flex-shrink-0">
                  <div className="text-xs font-medium text-muted">{dateStr}</div>
                  <div className="text-[10px] font-bold text-primary">
                    {daysLeft <= 0 ? "本日" : `あと${daysLeft}日`}
                  </div>
                </div>

                {/* クラス */}
                <span className="flex-shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-bold text-muted">
                  {e.className}
                </span>

                {/* 大会名 + 所属 */}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{e.eventName}</div>
                  <div className="truncate text-[10px] text-muted">
                    {e.prefecture}
                    {e.affiliation ? ` · ${e.affiliation}` : ""}
                  </div>
                </div>

                {/* 受付ステータス（none=判定不能はバッジ非表示） */}
                {e.entryStatus !== "none" && (
                  <span
                    className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold leading-none ${
                      e.entryStatus === "open"
                        ? "bg-green-500/15 text-green-400"
                        : "bg-white/5 text-muted"
                    }`}
                  >
                    {e.entryStatus === "open" ? "受付中" : "締切"}
                  </span>
                )}

                {/* 総エントリー数 */}
                <span className="hidden w-10 flex-shrink-0 text-right text-[10px] text-muted sm:block">
                  {e.totalEntries}人
                </span>

                <ExternalLink className="h-3 w-3 flex-shrink-0 text-muted/50" />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
