"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronRight } from "lucide-react";

interface EventItem {
  eventId: number;
  name: string;
  date: string;
}

/** 結果分析ランディングの大会ブラウズ（検索＋一覧）。クリックでクラス選択へ。 */
export function ResultsBrowse({ events }: { events: EventItem[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const k = q.trim();
    const base = k ? events.filter((e) => e.name.includes(k) || e.date.includes(k)) : events;
    return base.slice(0, 80);
  }, [q, events]);

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted">
        LapCenter 対応の大会一覧を取得できませんでした。
      </div>
    );
  }

  return (
    <div>
      <div className="relative mb-4">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input
          type="text"
          placeholder="大会名または日付(YYYY-MM-DD)で検索..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface py-2.5 pl-8 pr-3 text-sm outline-none focus:border-primary"
        />
      </div>

      <div className="space-y-1.5">
        {filtered.map((e) => (
          <Link
            key={e.eventId}
            href={`/results/${e.eventId}`}
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/30 hover:bg-card-hover"
          >
            <span className="w-[5.5rem] flex-shrink-0 font-mono text-xs text-muted">{e.date}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.name}</span>
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted" />
          </Link>
        ))}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">該当する大会がありません</p>
        )}
      </div>
      {!q && events.length > 80 && (
        <p className="mt-3 text-center text-[10px] text-muted">新しい順に80件を表示（検索で絞り込み）</p>
      )}
    </div>
  );
}
