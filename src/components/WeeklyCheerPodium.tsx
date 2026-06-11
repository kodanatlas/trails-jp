"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";

interface LikeEntry {
  athlete_name: string; // 空白除去名（athlete-index のキーと同形式）
  like_count: number;
}

/** 同率を同順位としてまとめた表彰台の段 */
interface Tier {
  count: number;
  names: string[];
}

/** 表示する選手数の上限（超過分は「+N人」） */
const MAX_NAMES = 6;

/** 表彰台の段ごとの装飾（1位/2位/3位） */
const PLACE_STYLES = [
  { medal: "🥇", block: "h-16 border-amber-400/40 bg-amber-400/15 text-amber-400" },
  { medal: "🥈", block: "h-12 border-slate-300/40 bg-slate-300/10 text-slate-300" },
  { medal: "🥉", block: "h-8 border-orange-400/40 bg-orange-400/10 text-orange-400" },
];

/** トップページ「今週の応援」表彰台（クライアント側で likes API を取得） */
export function WeeklyCheerPodium() {
  const [entries, setEntries] = useState<LikeEntry[] | null>(null);
  const [label, setLabel] = useState<"今週" | "累計">("今週");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 今週分（JST 月曜起点）→ 0 件なら累計にフォールバック
        const week = await fetchTop("/api/likes/top?window=week&limit=10");
        if (week.length > 0) {
          if (!cancelled) {
            setLabel("今週");
            setEntries(week);
          }
          return;
        }
        const total = await fetchTop("/api/likes/top?limit=10");
        if (!cancelled) {
          setLabel("累計");
          setEntries(total);
        }
      } catch {
        if (!cancelled) setEntries([]); // 失敗時はセクションごと非表示
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!entries || entries.length === 0) return null;

  // 同率は同順位にグルーピング（タイで切らない）。表彰台は上位3段まで。
  const tiers: Tier[] = [];
  for (const e of entries) {
    if (e.like_count <= 0) continue;
    const last = tiers[tiers.length - 1];
    if (last && last.count === e.like_count) {
      last.names.push(e.athlete_name);
    } else if (tiers.length < 3) {
      tiers.push({ count: e.like_count, names: [e.athlete_name] });
    } else {
      break;
    }
  }
  if (tiers.length === 0) return null;

  // 表示人数上限を段の並び順（上位段優先）で割り当て
  let used = 0;
  const display = tiers.map((tier, place) => {
    const shown = tier.names.slice(0, Math.max(0, MAX_NAMES - used));
    used += shown.length;
    return { ...tier, place, shown, overflow: tier.names.length - shown.length };
  });

  // 表彰台らしく 2位・1位・3位 の順で横に並べる
  const visualOrder = [display[1], display[0], display[2]].filter(
    (t): t is (typeof display)[number] => t != null,
  );

  return (
    <section className="border-b border-border py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Heart className="h-4 w-4 fill-pink-400 text-pink-400" />
            <h2 className="text-lg font-bold">{label}の応援</h2>
            <span className="rounded bg-pink-500/15 px-1.5 py-0.5 text-[9px] font-medium text-pink-400">
              応援数{label === "累計" ? "（累計）" : ""}
            </span>
          </div>
          <Link href="/analysis" className="text-xs font-medium text-primary hover:underline">
            応援タブへ →
          </Link>
        </div>

        <div className="mt-8 flex items-end justify-center gap-3 sm:gap-6">
          {visualOrder.map((tier) => {
            const style = PLACE_STYLES[tier.place];
            return (
              <div
                key={tier.place}
                className="flex w-full max-w-[220px] flex-1 flex-col items-center"
              >
                <span className="text-2xl">{style.medal}</span>
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-pink-500/15 px-2 py-0.5 text-xs font-bold text-pink-400">
                  <Heart className="h-3 w-3 fill-pink-400" />
                  {tier.count}
                </span>
                <div className="mt-2 flex flex-col items-center gap-0.5 pb-2">
                  {tier.shown.map((name) => (
                    <Link
                      key={name}
                      href={`/analysis?athlete=${encodeURIComponent(name)}`}
                      className="max-w-full truncate text-center text-sm font-semibold transition-colors hover:text-primary hover:underline"
                    >
                      {name}
                    </Link>
                  ))}
                  {tier.overflow > 0 && (
                    <span className="text-xs text-muted">+{tier.overflow}人</span>
                  )}
                </div>
                {/* 表彰台ブロック */}
                <div
                  className={`flex w-full items-center justify-center rounded-t-lg border border-b-0 font-mono text-lg font-bold ${style.block}`}
                >
                  {tier.place + 1}
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-border" />

        <p className="mt-4 text-center text-xs text-muted">
          <Link href="/analysis" className="text-primary hover:underline">
            選手分析の応援タブ
          </Link>
          から、あなたも気になる選手を応援できます。
        </p>
      </div>
    </section>
  );
}

/** likes top API を叩いて配列を返す（非配列・エラーは例外/空扱い） */
async function fetchTop(url: string): Promise<LikeEntry[]> {
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return Array.isArray(json) ? (json as LikeEntry[]) : [];
}
