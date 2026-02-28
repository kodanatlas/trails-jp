"use client";

import { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Loader2, TrendingUp, TrendingDown, Minus, Target, Zap, Calendar } from "lucide-react";
import type { AthleteSummary, AthleteProfile, LapCenterPerformance } from "@/lib/analysis/types";
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
  const [lcData, setLcData] = useState<LapCenterPerformance[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const loadProfile = loadAthleteDetail(summary).then((p) => setProfile(p));
    const loadLc = fetch("/api/lapcenter-runners")
      .then((r) => r.ok ? r.json() : null)
      .then((json) => json ?? fetch("/data/lapcenter-runners.json").then((r) => r.ok ? r.json() : null))
      .then((json) => {
        if (json?.athletes?.[summary.name]) {
          setLcData(json.athletes[summary.name] as LapCenterPerformance[]);
        } else {
          setLcData(null);
        }
      })
      .catch(() => setLcData(null));
    Promise.all([loadProfile, loadLc]).then(() => setLoading(false));
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
      {lcData && lcData.length >= 2 && <LapCenterChart data={lcData} profile={profile} />}
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
          <p className="text-[10px] text-muted">F・S 無差別平均</p>
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

type ChartRange = "6m" | "1y" | "2y" | "all";
const CHART_RANGES: { value: ChartRange; label: string }[] = [
  { value: "6m", label: "6ヶ月" },
  { value: "1y", label: "1年" },
  { value: "2y", label: "2年" },
  { value: "all", label: "全期間" },
];

function getChartCutoff(range: ChartRange): string {
  if (range === "all") return "";
  const now = new Date();
  switch (range) {
    case "6m": now.setMonth(now.getMonth() - 6); break;
    case "1y": now.setFullYear(now.getFullYear() - 1); break;
    case "2y": now.setFullYear(now.getFullYear() - 2); break;
  }
  return now.toISOString().slice(0, 10);
}

/** スコア推移チャート — Forest / Sprint 分離 */
function ScoreChart({ profile }: { profile: AthleteProfile }) {
  const [chartRange, setChartRange] = useState<ChartRange>("1y");

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

    const cutoff = getChartCutoff(chartRange);
    const data = [...dateMap.values()]
      .filter((d) => !cutoff || d.date >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      forestEvents: fEvents,
      sprintEvents: sEvents,
      chartData: data,
      hasForest: fEvents.length > 0,
      hasSprint: sEvents.length > 0,
    };
  }, [profile, chartRange]);

  if (chartData.length < 2) {
    return (
      <div className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted">
        チャート表示には2大会以上のデータが必要です
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
          スコア推移
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {CHART_RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setChartRange(r.value)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  chartRange === r.value
                    ? "bg-primary/20 text-primary"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
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

/** 値に応じて濃淡を返す（低=濃い=良い、高=薄い=悪い） */
function valOpacity(value: number, min: number, max: number): number {
  const range = max - min || 1;
  const t = Math.max(0, Math.min(1, (value - min) / range)); // 0=min(good), 1=max(bad)
  return 1 - t * 0.7; // 1.0(濃) → 0.3(薄)
}

/** イベント名ノイズ除去 (JOY↔LapCenter 近似一致用) */
function stripEventNoise(s: string): string {
  let r = s;
  r = r.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  r = r.replace(/20\d{2}年度?/g, "");
  r = r.replace(/20\d{2}/g, "");
  r = r.replace(/第\s*[0-9一二三四五六七八九十百千]+\s*回/g, "");
  r = r.replace(/(令和|平成)\s*[0-9一-九十]+\s*年度?/g, "");
  r = r.replace(/[（(][^)）]*[)）]/g, "");
  r = r.replace(/【[^】]*】/g, "");
  for (const w of ["大会", "地区", "年度", "兼", "in", "IN", "の", "・", "\u3000"]) r = r.replaceAll(w, "");
  r = r.replace(/[\s\-\/\\.,、。!！?？:：;；&＆'"_＿~～|｜\[\]［］{}]/g, "");
  return r.toLowerCase();
}

function eventFuzzyMatch(a: string, b: string): boolean {
  const na = stripEventNoise(a);
  const nb = stripEventNoise(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length >= 3 && longer.includes(shorter)) return true;
  if (shorter.length >= 4 && longer.length >= 4) {
    const trigrams = new Set<string>();
    for (let i = 0; i <= shorter.length - 3; i++) trigrams.add(shorter.substring(i, i + 3));
    let common = 0;
    for (let i = 0; i <= longer.length - 3; i++) {
      if (trigrams.has(longer.substring(i, i + 3))) common++;
    }
    if (common / trigrams.size >= 0.6 && common >= 3) return true;
  }
  return false;
}

/** LapCenter 巡航速度・ミス率推移チャート */
function LapCenterChart({ data, profile }: { data: LapCenterPerformance[]; profile: AthleteProfile }) {
  const [chartRange, setChartRange] = useState<ChartRange>("2y");

  const { chartData, hasForest, hasSprint, forestCount, sprintCount, speedMin, speedMax, missMin, missMax } = useMemo(() => {
    // JOYランキングからイベント情報を収集: date → [{type, name}]
    const joyByDate = new Map<string, Array<{ type: "forest" | "sprint"; name: string }>>();
    for (const r of profile.rankings) {
      const t = r.type.includes("forest") ? "forest" as const : r.type.includes("sprint") ? "sprint" as const : null;
      if (!t) continue;
      for (const e of r.events) {
        if (!e.date) continue;
        if (!joyByDate.has(e.date)) joyByDate.set(e.date, []);
        const arr = joyByDate.get(e.date)!;
        if (!arr.some((x) => x.type === t)) arr.push({ type: t, name: e.eventName });
      }
    }

    const cutoff = getChartCutoff(chartRange);

    // 同日同イベントは1つにまとめる（Forest/Sprint別）
    const dateMap = new Map<string, {
      date: string;
      fSpeed?: number; sSpeed?: number;
      fMiss?: number; sMiss?: number;
      fName?: string; sName?: string;
    }>();

    let fCount = 0;
    let sCount = 0;

    for (const p of data) {
      if (cutoff && p.d < cutoff) continue;

      // タイプ判定: JOYランキング日付マッチ（日付一致 + 名前近似一致 or 同日1タイプ）
      let type: "forest" | "sprint" | null = null;
      const candidates = joyByDate.get(p.d);
      if (!candidates) continue; // JOYにない日付はスキップ

      const types = new Set(candidates.map((c) => c.type));
      if (types.size === 1) {
        type = candidates[0].type;
      } else {
        for (const c of candidates) {
          if (eventFuzzyMatch(p.e, c.name)) { type = c.type; break; }
        }
      }
      if (!type) continue;

      if (!dateMap.has(p.d)) dateMap.set(p.d, { date: p.d });
      const entry = dateMap.get(p.d)!;

      if (type === "forest") {
        entry.fSpeed = p.s;
        entry.fMiss = p.m;
        entry.fName = p.e;
        fCount++;
      } else {
        entry.sSpeed = p.s;
        entry.sMiss = p.m;
        entry.sName = p.e;
        sCount++;
      }
    }

    const sorted = [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    const speeds = sorted.flatMap((d) => [d.fSpeed, d.sSpeed].filter((v): v is number => v != null));
    const misses = sorted.flatMap((d) => [d.fMiss, d.sMiss].filter((v): v is number => v != null));

    // 5点移動平均を計算
    const ma = (arr: (number | undefined)[]): (number | undefined)[] =>
      arr.map((_, i) => {
        const vals = arr.slice(Math.max(0, i - 4), i + 1).filter((v): v is number => v != null);
        return vals.length >= 3 ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 10) / 10 : undefined;
      });

    const fSpeedArr = sorted.map((d) => d.fSpeed);
    const sSpeedArr = sorted.map((d) => d.sSpeed);
    const fMissArr = sorted.map((d) => d.fMiss);
    const sMissArr = sorted.map((d) => d.sMiss);
    const fSpeedMa = ma(fSpeedArr);
    const sSpeedMa = ma(sSpeedArr);
    const fMissMa = ma(fMissArr);
    const sMissMa = ma(sMissArr);

    const withMa = sorted.map((d, i) => ({
      ...d,
      fSpeedMa: fSpeedMa[i],
      sSpeedMa: sSpeedMa[i],
      fMissMa: fMissMa[i],
      sMissMa: sMissMa[i],
    }));

    return {
      chartData: withMa,
      hasForest: fCount > 0,
      hasSprint: sCount > 0,
      forestCount: fCount,
      sprintCount: sCount,
      speedMin: speeds.length > 0 ? Math.min(...speeds) : 0,
      speedMax: speeds.length > 0 ? Math.max(...speeds) : 100,
      missMin: misses.length > 0 ? Math.min(...misses) : 0,
      missMax: misses.length > 0 ? Math.max(...misses) : 100,
    };
  }, [data, chartRange]);

  if (chartData.length < 2) return null;

  const sharedXAxis = (
    <XAxis
      dataKey="date"
      tick={{ fontSize: 10, fill: "#888" }}
      tickFormatter={(v) => v.slice(5)}
      axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
    />
  );

  const sharedGrid = (
    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
  );

  const tooltipStyle = {
    backgroundColor: "#1a2332",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    fontSize: 12,
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wider text-muted">
          巡航速度・ミス率推移
          <span className="ml-1 text-[9px] font-normal">(LapCenter)</span>
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {CHART_RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setChartRange(r.value)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  chartRange === r.value
                    ? "bg-primary/20 text-primary"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex gap-3 text-[10px]">
            {hasForest && (
              <span className="flex items-center gap-1 text-green-400">
                <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
                Forest ({forestCount})
              </span>
            )}
            {hasSprint && (
              <span className="flex items-center gap-1 text-blue-400">
                <span className="inline-block h-2 w-2 rounded-full bg-blue-400" />
                Sprint ({sprintCount})
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 巡航速度チャート */}
      <p className="mb-1 text-[10px] text-muted">巡航速度 (%)</p>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <defs>
              <linearGradient id="lcLineF" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4ade80" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#4ade80" stopOpacity={1} />
              </linearGradient>
              <linearGradient id="lcLineS" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#60a5fa" stopOpacity={1} />
              </linearGradient>
            </defs>
            {sharedGrid}
            {sharedXAxis}
            <YAxis
              tick={{ fontSize: 10, fill: "#888" }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(_, payload) => {
                const p = payload?.[0]?.payload;
                if (!p) return "";
                const parts: string[] = [p.date];
                if (p.fName) parts.push(`F: ${p.fName}`);
                if (p.sName) parts.push(`S: ${p.sName}`);
                return parts.join(" | ");
              }}
              formatter={(value, name) => {
                if (String(name).includes("Ma")) return [null as any, null];
                return [`${Number(value).toFixed(1)}%`, name === "fSpeed" ? "Forest" : "Sprint"];
              }}
            />
            {hasForest && (
              <Line
                name="fSpeed"
                type="monotone"
                dataKey="fSpeed"
                stroke="url(#lcLineF)"
                strokeWidth={2}
                dot={({ cx, cy, payload }: any) => {
                  const v = payload.fSpeed;
                  if (v == null) return <></>;
                  const op = valOpacity(v, speedMin, speedMax);
                  return <circle cx={cx} cy={cy} r={3.5} fill={`rgba(74,222,128,${op})`} />;
                }}
                activeDot={{ r: 5, fill: "#4ade80" }}
                connectNulls
              />
            )}
            {hasSprint && (
              <Line
                name="sSpeed"
                type="monotone"
                dataKey="sSpeed"
                stroke="url(#lcLineS)"
                strokeWidth={2}
                dot={({ cx, cy, payload }: any) => {
                  const v = payload.sSpeed;
                  if (v == null) return <></>;
                  const op = valOpacity(v, speedMin, speedMax);
                  return <circle cx={cx} cy={cy} r={3.5} fill={`rgba(96,165,250,${op})`} />;
                }}
                activeDot={{ r: 5, fill: "#60a5fa" }}
                connectNulls
              />
            )}
            {hasForest && (
              <Line
                name="fSpeedMa"
                type="monotone"
                dataKey="fSpeedMa"
                stroke="rgba(74,222,128,0.4)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={false}
                connectNulls
                legendType="none"
              />
            )}
            {hasSprint && (
              <Line
                name="sSpeedMa"
                type="monotone"
                dataKey="sSpeedMa"
                stroke="rgba(96,165,250,0.3)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={false}
                connectNulls
                legendType="none"
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ミス率チャート */}
      <p className="mb-1 mt-4 text-[10px] text-muted">ミス率 (%)</p>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <defs>
              <linearGradient id="lcLineFm" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4ade80" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#4ade80" stopOpacity={1} />
              </linearGradient>
              <linearGradient id="lcLineSm" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#60a5fa" stopOpacity={1} />
              </linearGradient>
            </defs>
            {sharedGrid}
            {sharedXAxis}
            <YAxis
              tick={{ fontSize: 10, fill: "#888" }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              domain={[0, "auto"]}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(_, payload) => {
                const p = payload?.[0]?.payload;
                if (!p) return "";
                const parts: string[] = [p.date];
                if (p.fName) parts.push(`F: ${p.fName}`);
                if (p.sName) parts.push(`S: ${p.sName}`);
                return parts.join(" | ");
              }}
              formatter={(value, name) => {
                if (String(name).includes("Ma")) return [null as any, null];
                return [`${Number(value).toFixed(1)}%`, name === "fMiss" ? "Forest" : "Sprint"];
              }}
            />
            {hasForest && (
              <Line
                name="fMiss"
                type="monotone"
                dataKey="fMiss"
                stroke="url(#lcLineFm)"
                strokeWidth={2}
                dot={({ cx, cy, payload }: any) => {
                  const v = payload.fMiss;
                  if (v == null) return <></>;
                  const op = valOpacity(v, missMin, missMax);
                  return <circle cx={cx} cy={cy} r={3.5} fill={`rgba(74,222,128,${op})`} />;
                }}
                activeDot={{ r: 5, fill: "#4ade80" }}
                connectNulls
              />
            )}
            {hasSprint && (
              <Line
                name="sMiss"
                type="monotone"
                dataKey="sMiss"
                stroke="url(#lcLineSm)"
                strokeWidth={2}
                dot={({ cx, cy, payload }: any) => {
                  const v = payload.sMiss;
                  if (v == null) return <></>;
                  const op = valOpacity(v, missMin, missMax);
                  return <circle cx={cx} cy={cy} r={3.5} fill={`rgba(96,165,250,${op})`} />;
                }}
                activeDot={{ r: 5, fill: "#60a5fa" }}
                connectNulls
              />
            )}
            {hasForest && (
              <Line
                name="fMissMa"
                type="monotone"
                dataKey="fMissMa"
                stroke="rgba(74,222,128,0.4)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={false}
                connectNulls
                legendType="none"
              />
            )}
            {hasSprint && (
              <Line
                name="sMissMa"
                type="monotone"
                dataKey="sMissMa"
                stroke="rgba(96,165,250,0.3)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={false}
                connectNulls
                legendType="none"
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

