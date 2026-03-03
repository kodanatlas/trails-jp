"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { TrendingUp, TrendingDown, TreePine, Zap, Heart, Trophy } from "lucide-react";
import type { AthleteIndex, AthleteSummary } from "@/lib/analysis/types";
import { LikeButton } from "./LikeButton";

interface SupportTabProps {
  athleteIndex: AthleteIndex;
  onSelectAthlete?: (athlete: AthleteSummary) => void;
}

export function SupportTab({ athleteIndex, onSelectAthlete }: SupportTabProps) {
  const { rising, falling } = useMemo(() => {
    const all = Object.values(athleteIndex.athletes).filter(
      (a) => a.recentForm !== 0 && a.bestRank <= 500
    );
    const sorted = [...all].sort((a, b) => b.recentForm - a.recentForm);
    return {
      rising: sorted.slice(0, 20),
      falling: sorted.slice(-20).reverse(),
    };
  }, [athleteIndex]);

  // いいね数を一括取得
  const allNames = useMemo(
    () => [...rising, ...falling].map((a) => a.name),
    [rising, falling],
  );
  const likeCounts = useLikeCounts(allNames);

  // いいねランキング
  const [topLiked, setTopLiked] = useState<{ athlete_name: string; like_count: number }[]>([]);
  useEffect(() => {
    fetch("/api/likes/top?limit=10")
      .then((r) => (r.ok ? r.json() : []))
      .then(setTopLiked)
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      {/* 調子上昇中 */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-bold">調子上昇中</h2>
          <span className="text-[10px] text-muted">直近3大会の伸び率上位20名</span>
        </div>
        <div className="space-y-1">
          {rising.map((a, i) => (
            <AthleteCheerCard
              key={a.name}
              athlete={a}
              rank={i + 1}
              likeCount={likeCounts[a.name] ?? 0}
              onSelect={onSelectAthlete}
            />
          ))}
        </div>
      </section>

      {/* 調子下降中 */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-red-400" />
          <h2 className="text-sm font-bold">調子下降中</h2>
          <span className="text-[10px] text-muted">直近3大会の伸び率下位20名</span>
        </div>
        <div className="space-y-1">
          {falling.map((a, i) => (
            <AthleteCheerCard
              key={a.name}
              athlete={a}
              rank={i + 1}
              likeCount={likeCounts[a.name] ?? 0}
              onSelect={onSelectAthlete}
            />
          ))}
        </div>
      </section>

      {/* いいねランキング */}
      {topLiked.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-bold">いいねランキング</h2>
          </div>
          <div className="space-y-1">
            {topLiked.map((row, i) => {
              const athlete = athleteIndex.athletes[row.athlete_name];
              return (
                <button
                  key={row.athlete_name}
                  onClick={() => athlete && onSelectAthlete?.(athlete)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-all hover:border-primary/30 hover:bg-card-hover"
                >
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-bold text-amber-400">
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{row.athlete_name}</p>
                    {athlete && (
                      <p className="truncate text-[10px] text-muted">
                        {athlete.clubs.join(" / ")}
                      </p>
                    )}
                  </div>
                  <div className="inline-flex items-center gap-1 text-pink-400">
                    <Heart className="h-3 w-3 fill-pink-400" />
                    <span className="text-sm font-bold">{row.like_count}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/** 複数選手のいいね数を一括取得するフック */
function useLikeCounts(names: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = names.join(",");

  const fetchCounts = useCallback(async () => {
    if (!names.length) return;
    try {
      const res = await fetch(`/api/likes?athletes=${encodeURIComponent(key)}`);
      if (res.ok) setCounts(await res.json());
    } catch {
      // 静かに失敗
    }
  }, [key, names.length]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  return counts;
}

const TYPE_STYLES: Record<AthleteSummary["type"], { badge: string; text: string; bar: string }> = {
  forester:   { badge: "bg-green-500/15 text-green-400",  text: "text-green-400",  bar: "bg-green-400" },
  sprinter:   { badge: "bg-blue-500/15 text-blue-400",    text: "text-blue-400",   bar: "bg-blue-400" },
  allrounder: { badge: "bg-purple-500/15 text-purple-400", text: "text-purple-400", bar: "bg-purple-400" },
  unknown:    { badge: "bg-white/10 text-muted",           text: "text-muted",      bar: "bg-gray-400" },
};

function DisciplineBadge({ type }: { type: AthleteSummary["type"] }) {
  const style = TYPE_STYLES[type];
  if (type === "forester") {
    return (
      <span className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium ${style.badge}`}>
        <TreePine className="h-2.5 w-2.5" />F
      </span>
    );
  }
  if (type === "sprinter") {
    return (
      <span className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium ${style.badge}`}>
        <Zap className="h-2.5 w-2.5" />S
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium ${style.badge}`}>
      <TreePine className="h-2.5 w-2.5" /><Zap className="h-2.5 w-2.5" />
    </span>
  );
}

function AthleteCheerCard({
  athlete,
  rank,
  likeCount,
  onSelect,
}: {
  athlete: AthleteSummary;
  rank: number;
  likeCount: number;
  onSelect?: (athlete: AthleteSummary) => void;
}) {
  const form = athlete.recentForm;
  const formStr =
    form > 0 ? `+${form.toFixed(1)}%` : `${form.toFixed(1)}%`;
  const style = TYPE_STYLES[athlete.type];
  const barColor = style.bar;
  const formColor = style.text;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(athlete)}
      onKeyDown={(e) => { if (e.key === "Enter") onSelect?.(athlete); }}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-all hover:border-primary/30 hover:bg-card-hover"
    >
      {/* カラーバー */}
      <div className={`h-10 w-1 flex-shrink-0 rounded-full ${barColor}`} />

      {/* ランク */}
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-surface text-[10px] font-bold text-muted">
        {rank}
      </div>

      {/* 選手情報 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold">{athlete.name}</p>
          <DisciplineBadge type={athlete.type} />
          <LikeButton athleteName={athlete.name} initialCount={likeCount} />
        </div>
        <p className="truncate text-[10px] text-muted">
          {athlete.clubs.join(" / ")}
        </p>
      </div>

      {/* recentForm */}
      <div className="flex-shrink-0 text-right">
        <p className={`font-mono text-sm font-bold ${formColor}`}>
          {formStr}
        </p>
        <p className="text-[10px] text-muted">
          {athlete.bestPoints.toLocaleString(undefined, {
            maximumFractionDigits: 1,
          })}
          pt
        </p>
      </div>
    </div>
  );
}
