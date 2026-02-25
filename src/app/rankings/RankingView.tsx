"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { ChevronDown, ChevronUp, Trophy, Medal, Search, ExternalLink, BarChart3, Loader2 } from "lucide-react";
import type { JOERankingEntry } from "@/lib/scraper/rankings";

interface RankingConfig {
  type: string;
  label: string;
  typeId: number;
  classes: { id: number; name: string; label: string }[];
}

interface RankingViewProps {
  rankingConfigs: RankingConfig[];
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-yellow-300 to-yellow-600 text-[10px] font-bold text-white shadow"><Trophy className="h-3 w-3" /></div>;
  if (rank === 2) return <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-gray-300 to-gray-500 text-[10px] font-bold text-white shadow"><Medal className="h-3 w-3" /></div>;
  if (rank === 3) return <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-700 text-[10px] font-bold text-white shadow"><Medal className="h-3 w-3" /></div>;
  return <div className="flex h-6 w-6 items-center justify-center text-xs text-muted">{rank}</div>;
}

function PointsBar({ points, maxPoints }: { points: number; maxPoints: number }) {
  const width = maxPoints > 0 ? (points / maxPoints) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-[#00e5ff]"
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="w-16 text-right font-mono text-sm font-bold text-primary">
        {points.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
      </span>
    </div>
  );
}

/** カテゴリキーから静的JSONファイルのパスを生成 */
function dataUrl(type: string, className: string): string {
  return `/data/rankings/${type}_${className}.json`;
}

export function RankingView({ rankingConfigs }: RankingViewProps) {
  const [selectedType, setSelectedType] = useState(rankingConfigs[0]?.type ?? "");
  const [selectedClass, setSelectedClass] = useState(rankingConfigs[0]?.classes[0]?.name ?? "");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedRank, setExpandedRank] = useState<number | null>(null);
  const [hideInactive, setHideInactive] = useState(false);

  // データキャッシュ: fetch 済みのカテゴリをメモリに保持
  const [cache, setCache] = useState<Record<string, JOERankingEntry[]>>({});
  const [loading, setLoading] = useState(false);

  const dataKey = `${selectedType}:${selectedClass}`;
  const rankings = cache[dataKey] ?? [];
  const maxPoints = rankings[0]?.total_points ?? 1;

  const currentConfig = rankingConfigs.find((c) => c.type === selectedType);

  // カテゴリ変更時にデータを fetch
  const fetchData = useCallback(async (type: string, className: string) => {
    const key = `${type}:${className}`;
    if (cache[key]) return; // キャッシュ済み

    setLoading(true);
    try {
      const res = await fetch(dataUrl(type, className));
      if (res.ok) {
        const entries: JOERankingEntry[] = await res.json();
        setCache((prev) => ({ ...prev, [key]: entries }));
      }
    } catch {
      // fetch 失敗時は空のまま
    } finally {
      setLoading(false);
    }
  }, [cache]);

  // 初回 & 切り替え時に fetch
  useEffect(() => {
    fetchData(selectedType, selectedClass);
  }, [selectedType, selectedClass, fetchData]);

  const filtered = useMemo(() => {
    let result = rankings;
    if (hideInactive) {
      result = result.filter((r) => r.is_active);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) => r.athlete_name.toLowerCase().includes(q) || r.club.toLowerCase().includes(q)
      );
    }
    return result;
  }, [rankings, searchQuery, hideInactive]);

  return (
    <div>
      {/* Ranking Type Tabs */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {rankingConfigs.map((config) => (
          <button
            key={config.type}
            onClick={() => {
              setSelectedType(config.type);
              setSelectedClass(config.classes[0]?.name ?? "");
              setExpandedRank(null);
              setSearchQuery("");
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedType === config.type
                ? "bg-primary text-white"
                : "border border-border text-muted hover:text-foreground"
            }`}
          >
            {config.label}
          </button>
        ))}
      </div>

      {/* Class Selector */}
      {currentConfig && (
        <div className="mb-4 flex flex-wrap gap-1">
          {currentConfig.classes.map((cls) => (
            <button
              key={cls.name}
              onClick={() => { setSelectedClass(cls.name); setExpandedRank(null); }}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                selectedClass === cls.name
                  ? "bg-[#00e5ff]/20 text-[#00e5ff]"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {cls.label}
            </button>
          ))}
        </div>
      )}

      {/* Search + Filters */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="選手名・所属で検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={hideInactive}
            onChange={(e) => setHideInactive(e.target.checked)}
            className="accent-primary"
          />
          対象外を非表示
        </label>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="ml-2 text-sm text-muted">読み込み中...</span>
        </div>
      )}

      {/* Content */}
      {!loading && (
        <>
          <p className="mb-3 text-xs text-muted">
            {filtered.length} 人
            {rankings.length !== filtered.length && ` / 全 ${rankings.length} 人`}
          </p>

          <div className="space-y-1.5">
            {filtered.map((entry) => (
              <div key={`${dataKey}:${entry.rank}`}>
                <button
                  onClick={() => setExpandedRank(expandedRank === entry.rank ? null : entry.rank)}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                    expandedRank === entry.rank
                      ? "border-primary/30 bg-card-hover"
                      : "border-border bg-card hover:border-primary/20 hover:bg-card-hover"
                  } ${!entry.is_active ? "opacity-50" : ""}`}
                >
                  <RankBadge rank={entry.rank} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{entry.athlete_name}</span>
                      {!entry.is_active && (
                        <span className="flex-shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-muted">対象外</span>
                      )}
                    </div>
                    <div className="text-xs text-muted">{entry.club}</div>
                  </div>

                  <div className="hidden w-48 sm:block">
                    <PointsBar points={entry.total_points} maxPoints={maxPoints} />
                  </div>

                  <div className="block font-mono text-sm font-bold text-primary sm:hidden">
                    {entry.total_points.toLocaleString(undefined, { minimumFractionDigits: 1 })}
                  </div>

                  {expandedRank === entry.rank
                    ? <ChevronUp className="h-4 w-4 flex-shrink-0 text-muted" />
                    : <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted" />
                  }
                </button>

                {expandedRank === entry.rank && (
                  <div className="ml-9 mt-1 rounded-lg border border-border bg-surface p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <BarChart3 className="h-3.5 w-3.5 text-primary" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">大会別ポイント</span>
                    </div>

                    <div className="space-y-1.5">
                      {[...entry.event_scores]
                        .sort((a, b) => b.points - a.points)
                        .map((score, i) => {
                          const topPoints = entry.event_scores.reduce((max, s) => Math.max(max, s.points), 1);
                          const barWidth = (score.points / topPoints) * 100;
                          const isTop3 = i < 3;
                          return (
                            <div key={`${score.event_name}-${i}`} className="flex items-center gap-2">
                              <span className={`w-36 truncate text-xs ${isTop3 ? "font-medium" : "text-muted"}`}>
                                {score.event_name}
                              </span>
                              <div className="h-4 flex-1 overflow-hidden rounded bg-white/5">
                                <div
                                  className={`h-full rounded ${isTop3 ? "bg-primary/60" : "bg-white/10"}`}
                                  style={{ width: `${barWidth}%` }}
                                />
                              </div>
                              <span className={`w-12 text-right font-mono text-xs ${isTop3 ? "font-bold text-primary" : "text-muted"}`}>
                                {score.points}
                              </span>
                            </div>
                          );
                        })}
                    </div>

                    <div className="mt-3 flex gap-2">
                      <a
                        href="https://japan-o-entry.com/ranking/ranking/ranking_index"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 rounded bg-white/5 px-2.5 py-1 text-[10px] text-muted transition-colors hover:bg-white/10 hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                        JOY で詳細を見る
                      </a>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {rankings.length === 0 && (
              <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted">
                このカテゴリのランキングデータはまだありません
              </div>
            )}

            {rankings.length > 0 && filtered.length === 0 && (
              <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted">
                該当する選手がいません
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
