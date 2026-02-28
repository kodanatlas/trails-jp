"use client";

import { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Loader2, TrendingUp, TrendingDown, Minus, Target, Zap, Calendar } from "lucide-react";
import type { AthleteSummary, AthleteProfile } from "@/lib/analysis/types";
import {
  loadAthleteDetail,
  calcConsistency,
  calcRecentForm,
  getAllEvents,
  typeLabel,
  getBestRanks,
} from "@/lib/analysis/utils";

interface Props {
  summary: AthleteSummary;
}

export function AthleteDetail({ summary }: Props) {
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    loadAthleteDetail(summary).then((p) => {
      setProfile(p);
      setLoading(false);
    });
  }, [summary]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted">詳細データを読み込み中...</span>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="space-y-5">
      <ProfileHeader profile={profile} />
      <TypeBadge profile={profile} />
      <StatsCards profile={profile} />
      <ScoreChart profile={profile} />
      <RecentEvents profile={profile} />
    </div>
  );
}

/** ヘッダー: 名前・クラブ・カテゴリ数 */
function ProfileHeader({ profile }: { profile: AthleteProfile }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">{profile.name}</h2>
          <p className="text-xs text-muted">{profile.clubs.join(" / ")}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-primary">
            {profile.bestPoints.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          </p>
          <p className="text-[10px] text-muted">最高ポイント</p>
        </div>
      </div>
    </div>
  );
}

/** 特性バッジ + Forest/Sprint 比較バー (Feature 2) */
function TypeBadge({ profile }: { profile: AthleteProfile }) {
  const { forestRank, forestPoints, sprintRank, sprintPoints } = getBestRanks(
    profile.appearances
  );

  const typeColors: Record<string, string> = {
    sprinter: "bg-blue-500/15 text-blue-400",
    forester: "bg-green-500/15 text-green-400",
    allrounder: "bg-purple-500/15 text-purple-400",
    unknown: "bg-white/10 text-muted",
  };

  const total = forestPoints + sprintPoints;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Zap className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">特性分類</span>
      </div>

      <div className="flex items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${typeColors[profile.type]}`}>
          {typeLabel(profile.type)}
        </span>
        <span className="text-xs text-muted">
          Forest: {profile.forestCount} カテゴリ / Sprint: {profile.sprintCount} カテゴリ
        </span>
      </div>

      {/* Forest vs Sprint bar */}
      {total > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[10px] text-muted">
            <span>Forest {forestRank !== null ? `(${forestRank}位)` : ""}</span>
            <span>Sprint {sprintRank !== null ? `(${sprintRank}位)` : ""}</span>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full">
            <div
              className="bg-green-500/60 transition-all"
              style={{ width: `${(forestPoints / total) * 100}%` }}
            />
            <div
              className="bg-blue-500/60 transition-all"
              style={{ width: `${(sprintPoints / total) * 100}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] font-mono text-muted">
            <span>{forestPoints.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
            <span>{sprintPoints.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** スタッツカード: 安定性・調子・ベストスコア */
function StatsCards({ profile }: { profile: AthleteProfile }) {
  const allEvents = useMemo(() => getAllEvents(profile), [profile]);
  const consistency = calcConsistency(allEvents);
  const recentForm = calcRecentForm(allEvents);
  const best = allEvents.length > 0
    ? allEvents.reduce((max, e) => (e.points > max.points ? e : max))
    : null;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {/* 安定性 */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">安定性</span>
        </div>
        <p className="mt-1 text-2xl font-bold">
          {allEvents.length >= 2 ? `${consistency}` : "—"}
          {allEvents.length >= 2 && <span className="text-sm text-muted">/100</span>}
        </p>
        <p className="text-[10px] text-muted">
          {consistency >= 70 ? "非常に安定" : consistency >= 40 ? "やや安定" : allEvents.length >= 2 ? "ばらつきあり" : "データ不足"}
        </p>
      </div>

      {/* 最近の調子 */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-1.5">
          {recentForm > 0 ? (
            <TrendingUp className="h-3.5 w-3.5 text-green-400" />
          ) : recentForm < 0 ? (
            <TrendingDown className="h-3.5 w-3.5 text-red-400" />
          ) : (
            <Minus className="h-3.5 w-3.5 text-muted" />
          )}
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">最近の調子</span>
        </div>
        <p className={`mt-1 text-2xl font-bold ${recentForm > 0 ? "text-green-400" : recentForm < 0 ? "text-red-400" : ""}`}>
          {allEvents.length >= 2 ? `${recentForm > 0 ? "+" : ""}${recentForm}%` : "—"}
        </p>
        <p className="text-[10px] text-muted">直近3大会 vs 全体平均</p>
      </div>

      {/* ベストスコア */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-yellow-400" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">ベストスコア</span>
        </div>
        <p className="mt-1 text-2xl font-bold text-primary">
          {best ? best.points.toLocaleString() : "—"}
        </p>
        <p className="truncate text-[10px] text-muted">
          {best ? `${best.date} ${best.eventName}` : "—"}
        </p>
      </div>
    </div>
  );
}

/** スコア推移チャート — Forest / Sprint 分離 */
function ScoreChart({ profile }: { profile: AthleteProfile }) {
  const { forestEvents, sprintEvents, chartData, hasForest, hasSprint } = useMemo(() => {
    const fEvents: { date: string; eventName: string; points: number }[] = [];
    const sEvents: { date: string; eventName: string; points: number }[] = [];
    const seenF = new Set<string>();
    const seenS = new Set<string>();

    for (const r of profile.rankings) {
      const isForest = r.type.includes("forest");
      for (const e of r.events) {
        if (!e.date) continue;
        const key = `${e.date}:${e.eventName}`;
        if (isForest) {
          if (!seenF.has(key)) { seenF.add(key); fEvents.push(e); }
        } else {
          if (!seenS.has(key)) { seenS.add(key); sEvents.push(e); }
        }
      }
    }

    // 日付でまとめる
    const dateMap = new Map<string, { date: string; forest?: number; sprint?: number; fName?: string; sName?: string }>();
    for (const e of fEvents) {
      if (!dateMap.has(e.date)) dateMap.set(e.date, { date: e.date });
      const d = dateMap.get(e.date)!;
      d.forest = e.points;
      d.fName = e.eventName;
    }
    for (const e of sEvents) {
      if (!dateMap.has(e.date)) dateMap.set(e.date, { date: e.date });
      const d = dateMap.get(e.date)!;
      d.sprint = e.points;
      d.sName = e.eventName;
    }

    const data = [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    return {
      forestEvents: fEvents,
      sprintEvents: sEvents,
      chartData: data,
      hasForest: fEvents.length > 0,
      hasSprint: sEvents.length > 0,
    };
  }, [profile]);

  if (chartData.length < 2) {
    return (
      <div className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted">
        チャート表示には2大会以上のデータが必要です
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
          スコア推移
        </h3>
        <div className="flex gap-3 text-[10px]">
          {hasForest && (
            <span className="flex items-center gap-1 text-green-400">
              <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
              Forest ({forestEvents.length})
            </span>
          )}
          {hasSprint && (
            <span className="flex items-center gap-1 text-blue-400">
              <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />
              Sprint ({sprintEvents.length})
            </span>
          )}
        </div>
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#888" }}
              tickFormatter={(v) => v.slice(5)}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#888" }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1a2332",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                fontSize: 12,
              }}
              labelFormatter={(_, payload) => {
                const p = payload?.[0]?.payload;
                if (!p) return "";
                const parts: string[] = [p.date];
                if (p.fName) parts.push(`F: ${p.fName}`);
                if (p.sName) parts.push(`S: ${p.sName}`);
                return parts.join(" | ");
              }}
              formatter={(value, name) => {
                const label = name === "forest" ? "Forest" : "Sprint";
                return [Number(value).toLocaleString(), label];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              formatter={(value) => (value === "forest" ? "Forest" : "Sprint")}
            />
            {hasForest && (
              <Line
                name="forest"
                type="monotone"
                dataKey="forest"
                stroke="#4ade80"
                strokeWidth={2}
                dot={{ fill: "#4ade80", r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            )}
            {hasSprint && (
              <Line
                name="sprint"
                type="monotone"
                dataKey="sprint"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={{ fill: "#60a5fa", r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** 最近の大会参加状況 */
function RecentEvents({ profile }: { profile: AthleteProfile }) {
  const allEvents = useMemo(() => getAllEvents(profile), [profile]);

  if (allEvents.length === 0) return null;

  // 新しい順にソート
  const recent = [...allEvents].sort((a, b) => b.date.localeCompare(a.date));
  const maxPoints = Math.max(...allEvents.map((e) => e.points));
  const avgPoints = allEvents.reduce((s, e) => s + e.points, 0) / allEvents.length;

  // 成績レベル判定: 平均・標準偏差ベースで5段階
  const variance = allEvents.reduce((s, e) => s + (e.points - avgPoints) ** 2, 0) / allEvents.length;
  const stdDev = Math.sqrt(variance);

  function performanceLevel(points: number): "excellent" | "good" | "average" | "below" | "poor" {
    if (points >= avgPoints + stdDev) return "excellent";
    if (points >= avgPoints + stdDev * 0.3) return "good";
    if (points >= avgPoints - stdDev * 0.3) return "average";
    if (points >= avgPoints - stdDev) return "below";
    return "poor";
  }

  const levelColors = {
    excellent: { bar: "bg-green-400/70", text: "text-green-400", dot: "bg-green-400", bg: "bg-green-500/5" },
    good:      { bar: "bg-emerald-400/50", text: "text-emerald-400", dot: "bg-emerald-400", bg: "" },
    average:   { bar: "bg-primary/40", text: "text-primary", dot: "bg-primary", bg: "" },
    below:     { bar: "bg-amber-400/50", text: "text-amber-400", dot: "bg-amber-400", bg: "" },
    poor:      { bar: "bg-red-400/50", text: "text-red-400", dot: "bg-red-400", bg: "bg-red-500/5" },
  };

  // 直近1年の大会数
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const oneYearAgoStr = oneYearAgo.toISOString().slice(0, 10);
  const recentCount = recent.filter((e) => e.date >= oneYearAgoStr).length;

  // 月別データ（直近12ヶ月）: 頻度 + 平均ポイント
  const monthData: Record<string, { count: number; totalPts: number }> = {};
  for (const e of recent) {
    if (e.date >= oneYearAgoStr) {
      const month = e.date.slice(0, 7);
      if (!monthData[month]) monthData[month] = { count: 0, totalPts: 0 };
      monthData[month].count++;
      monthData[month].totalPts += e.points;
    }
  }

  // 12ヶ月分のグリッド生成
  const months: { label: string; key: string; count: number; avgPts: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${d.getMonth() + 1}月`;
    const md = monthData[key];
    months.push({
      label,
      key,
      count: md?.count || 0,
      avgPts: md ? md.totalPts / md.count : 0,
    });
  }
  const maxMonthCount = Math.max(...months.map((m) => m.count), 1);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            大会参加状況
          </span>
        </div>
        <span className="text-xs text-muted">
          直近1年: <span className="font-bold text-foreground">{recentCount}</span> 大会 /
          通算: <span className="font-bold text-foreground">{allEvents.length}</span> 大会
        </span>
      </div>

      {/* 凡例 */}
      <div className="mb-3 flex flex-wrap gap-2.5 text-[9px] text-muted">
        {([
          { level: "excellent" as const, label: "好成績" },
          { level: "good" as const, label: "やや良い" },
          { level: "average" as const, label: "平均的" },
          { level: "below" as const, label: "やや低い" },
          { level: "poor" as const, label: "低調" },
        ]).map((l) => (
          <span key={l.level} className="flex items-center gap-1">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${levelColors[l.level].dot}`} />
            {l.label}
          </span>
        ))}
      </div>

      {/* 月別アクティビティ */}
      <div className="mb-4">
        <p className="mb-1.5 text-[10px] text-muted">月別参加頻度（直近12ヶ月）</p>
        <div className="flex gap-1">
          {months.map((m) => {
            const level = m.count > 0 ? performanceLevel(m.avgPts) : "average";
            return (
              <div key={m.key} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-10 w-full items-end justify-center">
                  <div
                    className={`w-full rounded-sm transition-all ${m.count > 0 ? levelColors[level].bar : ""}`}
                    style={{
                      height: m.count > 0 ? `${Math.max((m.count / maxMonthCount) * 100, 15)}%` : "0%",
                    }}
                  />
                </div>
                <span className="text-[8px] text-muted">{m.label}</span>
                {m.count > 0 && (
                  <span className={`text-[8px] font-bold ${levelColors[level].text}`}>{m.count}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 大会リスト */}
      <div className="space-y-1">
        {recent.slice(0, 10).map((e, i) => {
          const barWidth = maxPoints > 0 ? (e.points / maxPoints) * 100 : 0;
          const level = performanceLevel(e.points);
          const colors = levelColors[level];
          const dt = new Date(e.date + "T00:00:00");
          const dateStr = `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
          return (
            <div
              key={`${e.date}-${e.eventName}-${i}`}
              className={`flex items-center gap-2 rounded p-2 ${colors.bg || "bg-surface"}`}
            >
              <span className={`h-2 w-2 flex-shrink-0 rounded-full ${colors.dot}`} />
              <span className="w-20 flex-shrink-0 text-xs font-medium text-muted">
                {dateStr}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs">{e.eventName}</span>
              <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-white/5 sm:block">
                <div
                  className={`h-full rounded-full ${colors.bar}`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              <span className={`w-12 flex-shrink-0 text-right font-mono text-xs font-bold ${colors.text}`}>
                {e.points.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>

      {recent.length > 10 && (
        <p className="mt-2 text-center text-[10px] text-muted">
          直近10大会を表示（全{recent.length}大会）
        </p>
      )}
    </div>
  );
}

