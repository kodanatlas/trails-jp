"use client";

import { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Search, X, Loader2, Plus, Trash2, TreePine, Zap } from "lucide-react";
import type { AthleteIndex, AthleteSummary, AthleteProfile, LapCenterPerformance } from "@/lib/analysis/types";
import {
  loadAthleteDetail,
  calcConsistency,
  calcRecentForm,
  getAllEvents,
  typeLabel,
  getBestRanks,
} from "@/lib/analysis/utils";
import { AthleteDistribution } from "./DistributionCharts";

export const COMPARE_COLORS = [
  "#00e5ff", "#f97316", "#a855f7", "#22c55e",
  "#ec4899", "#eab308", "#06b6d4", "#ef4444",
];

export interface CompareEntry {
  id: string;
  athlete: AthleteSummary | null;
  color: string;
}

interface Props {
  athleteIndex: AthleteIndex;
  entries: CompareEntry[];
  onEntriesChange: (entries: CompareEntry[]) => void;
}

let entryCounter = 100;

export function CompareAthletes({ athleteIndex, entries, onEntriesChange }: Props) {
  const selectedEntries = entries.filter((e) => e.athlete !== null) as (CompareEntry & { athlete: AthleteSummary })[];
  const canCompare = selectedEntries.length >= 2;

  const handleSelect = (id: string, athlete: AthleteSummary | null) => {
    onEntriesChange(entries.map((e) => (e.id === id ? { ...e, athlete } : e)));
  };

  const handleAdd = () => {
    const usedColors = new Set(entries.map((e) => e.color));
    const nextColor = COMPARE_COLORS.find((c) => !usedColors.has(c))
      ?? COMPARE_COLORS[entries.length % COMPARE_COLORS.length];
    entryCounter++;
    onEntriesChange([...entries, {
      id: String(entryCounter),
      athlete: null,
      color: nextColor,
    }]);
  };

  const handleRemove = (id: string) => {
    if (entries.length <= 2) return;
    onEntriesChange(entries.filter((e) => e.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry, index) => (
          <AthleteSearchSlot
            key={entry.id}
            label={`選手${index + 1}`}
            color={entry.color}
            athleteIndex={athleteIndex}
            selected={entry.athlete}
            onSelect={(a) => handleSelect(entry.id, a)}
            onRemove={entries.length > 2 ? () => handleRemove(entry.id) : undefined}
          />
        ))}
        <button
          onClick={handleAdd}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-3 text-sm text-muted transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          選手を追加
        </button>
      </div>

      {canCompare ? (
        <CompareView entries={selectedEntries} athleteIndex={athleteIndex} />
      ) : (
        <div className="rounded-lg border border-border bg-card py-12 text-center text-sm text-muted">
          2名以上の選手を選択して比較を開始
        </div>
      )}
    </div>
  );
}

function AthleteSearchSlot({
  label,
  color,
  athleteIndex,
  selected,
  onSelect,
  onRemove,
}: {
  label: string;
  color: string;
  athleteIndex: AthleteIndex;
  selected: AthleteSummary | null;
  onSelect: (a: AthleteSummary | null) => void;
  onRemove?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const results = useMemo(() => {
    if (!query) return [];
    const isAsciiOnly = /^[\x00-\x7F]+$/.test(query);
    if (isAsciiOnly && query.length < 2) return [];
    const q = query.toLowerCase();
    return Object.values(athleteIndex.athletes)
      .filter((a) => a.name.toLowerCase().includes(q) || a.clubs.some((c) => c.toLowerCase().includes(q)))
      .sort((a, b) => a.bestRank - b.bestRank)
      .slice(0, 8);
  }, [athleteIndex, query]);

  if (selected) {
    return (
      <div className="rounded-lg border-2 p-3" style={{ borderColor: `${color}40` }}>
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium" style={{ color }}>{label}</p>
            <p className="truncate text-sm font-bold">{selected.name}</p>
            <p className="truncate text-[10px] text-muted">{selected.clubs.join(" / ")}</p>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => { onSelect(null); setQuery(""); }}
              className="rounded-full p-1 text-muted hover:bg-white/10 hover:text-foreground"
              title="選手を変更"
            >
              <X className="h-4 w-4" />
            </button>
            {onRemove && (
              <button
                onClick={onRemove}
                className="rounded-full p-1 text-muted hover:bg-red-500/20 hover:text-red-400"
                title="スロットを削除"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <p className="mb-1.5 text-[10px] font-medium" style={{ color }}>{label}</p>
          {onRemove && (
            <button
              onClick={onRemove}
              className="-mt-1 rounded-full p-1 text-muted hover:bg-red-500/20 hover:text-red-400"
              title="スロットを削除"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="選手名で検索..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 200)}
            className="w-full rounded border border-border bg-surface py-1.5 pl-7 pr-2 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>

      {focused && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-border bg-card shadow-xl">
          {results.map((a) => (
            <button
              key={a.name}
              onMouseDown={() => {
                onSelect(a);
                setQuery(a.name);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-card-hover"
            >
              <span className="font-medium">{a.name}</span>
              <span className="text-[10px] text-muted">{a.clubs[0]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- CompareView ---

interface AthleteStats {
  entry: CompareEntry & { athlete: AthleteSummary };
  profile: AthleteProfile;
  events: { date: string; eventName: string; points: number }[];
  consistency: number;
  recentForm: number;
  bestRanks: { forestRank: number | null; sprintRank: number | null };
}

function CompareView({
  entries,
  athleteIndex,
}: {
  entries: (CompareEntry & { athlete: AthleteSummary })[];
  athleteIndex: AthleteIndex;
}) {
  const [profiles, setProfiles] = useState<Map<string, AthleteProfile>>(new Map());
  const [lcAll, setLcAll] = useState<Record<string, LapCenterPerformance[]> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const loadProfiles = Promise.all(entries.map((e) => loadAthleteDetail(e.athlete))).then((results) => {
      const map = new Map<string, AthleteProfile>();
      results.forEach((profile, i) => {
        map.set(entries[i].id, profile);
      });
      setProfiles(map);
    });
    const targetNames = entries.map((e) => e.athlete.name);
    const loadLc = Promise.all(
      targetNames.map((name) =>
        fetch(`/api/lc/${encodeURIComponent(name)}`)
          .then((r) => r.ok ? r.json() as Promise<LapCenterPerformance[]> : null)
          .then((records) => [name, records] as const)
          .catch(() => [name, null] as const)
      )
    ).then((results) => {
      const merged: Record<string, LapCenterPerformance[]> = {};
      for (const [name, records] of results) {
        if (records && records.length > 0) merged[name] = records;
      }
      setLcAll(Object.keys(merged).length > 0 ? merged : null);
    });
    Promise.all([loadProfiles, loadLc]).then(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.map((e) => e.athlete.name).join(",")]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted">比較データを読み込み中...</span>
      </div>
    );
  }

  if (profiles.size < 2) return null;

  const athleteStats: AthleteStats[] = entries
    .filter((e) => profiles.has(e.id))
    .map((entry) => {
      const profile = profiles.get(entry.id)!;
      const events = getAllEvents(profile);
      return {
        entry,
        profile,
        events,
        consistency: calcConsistency(events),
        recentForm: calcRecentForm(events),
        bestRanks: getBestRanks(profile.appearances),
      };
    });

  if (athleteStats.length < 2) return null;

  // helpers for best value
  const bestIdx = (vals: number[], higher: boolean) => {
    let best = higher ? -Infinity : Infinity;
    let idx = -1;
    for (let i = 0; i < vals.length; i++) {
      if ((higher && vals[i] > best) || (!higher && vals[i] < best)) {
        best = vals[i];
        idx = i;
      }
    }
    return best;
  };

  const makeBestSet = (vals: number[], higher: boolean) => {
    const b = bestIdx(vals, higher);
    return new Set(vals.map((v, i) => (v === b ? i : -1)).filter((i) => i >= 0));
  };

  return (
    <div className="space-y-4">
      {/* Stats comparison */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          スタッツ比較
        </h3>
        <div className="overflow-x-auto">
          <div style={{ minWidth: Math.max(300, 80 + athleteStats.length * 70) }}>
            {/* Header */}
            <div className="mb-2 flex items-center gap-1 border-b border-border pb-2">
              <span className="w-20 shrink-0" />
              <div className="flex flex-1 gap-1">
                {athleteStats.map((s) => (
                  <span
                    key={s.entry.id}
                    className="flex-1 truncate text-center text-[10px] font-semibold"
                    style={{ color: s.entry.color }}
                  >
                    {s.profile.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <CompareRow
                label="F・S平均ポイント"
                values={athleteStats.map((s) => s.profile.avgTotalPoints)}
                colors={athleteStats.map((s) => s.entry.color)}
                format={(v) => v.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                bestSet={makeBestSet(athleteStats.map((s) => s.profile.avgTotalPoints), true)}
              />
              <CompareRow
                label="最高ランク"
                values={athleteStats.map((s) => s.profile.bestRank)}
                colors={athleteStats.map((s) => s.entry.color)}
                format={(v) => `${v}位`}
                bestSet={makeBestSet(athleteStats.map((s) => s.profile.bestRank), false)}
              />
              <CompareRow
                label="安定性"
                values={athleteStats.map((s) => s.consistency)}
                colors={athleteStats.map((s) => s.entry.color)}
                format={(v) => `${v}/100`}
                bestSet={makeBestSet(athleteStats.map((s) => s.consistency), true)}
              />
              <CompareRow
                label="最近の調子"
                values={athleteStats.map((s) => s.recentForm)}
                colors={athleteStats.map((s) => s.entry.color)}
                format={(v) => `${v > 0 ? "+" : ""}${v}%`}
                bestSet={makeBestSet(athleteStats.map((s) => s.recentForm), true)}
              />
              <CompareRow
                label="特性"
                values={athleteStats.map((s) => 0)}
                colors={athleteStats.map((s) => s.entry.color)}
                format={(_, i) => typeLabel(athleteStats[i].profile.type)}
                bestSet={new Set()}
              />
              <CompareRow
                label="Forest 最高"
                values={athleteStats.map((s) => s.bestRanks.forestRank ?? 9999)}
                colors={athleteStats.map((s) => s.entry.color)}
                format={(v) => (v === 9999 ? "—" : `${v}位`)}
                bestSet={makeBestSet(
                  athleteStats.map((s) => s.bestRanks.forestRank ?? 9999),
                  false,
                )}
              />
              <CompareRow
                label="Sprint 最高"
                values={athleteStats.map((s) => s.bestRanks.sprintRank ?? 9999)}
                colors={athleteStats.map((s) => s.entry.color)}
                format={(v) => (v === 9999 ? "—" : `${v}位`)}
                bestSet={makeBestSet(
                  athleteStats.map((s) => s.bestRanks.sprintRank ?? 9999),
                  false,
                )}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <CompareCharts entries={entries} profiles={profiles} lcAll={lcAll} />

      {/* Distribution */}
      <AthleteDistribution
        athleteIndex={athleteIndex}
        highlightAthletes={entries.map((e) => ({
          name: e.athlete.name,
          color: e.color,
        }))}
      />
    </div>
  );
}

function CompareRow({
  label,
  values,
  colors,
  format,
  bestSet,
}: {
  label: string;
  values: number[];
  colors: string[];
  format: (v: number, i: number) => string;
  bestSet: Set<number>;
}) {
  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="w-20 shrink-0 text-[10px] text-muted">{label}</span>
      <div className="flex flex-1 gap-1">
        {values.map((v, i) => (
          <span
            key={i}
            className={`flex-1 text-center font-mono text-xs font-bold ${
              bestSet.has(i) ? "" : "text-muted"
            }`}
            style={bestSet.has(i) ? { color: colors[i] } : undefined}
          >
            {format(v, i)}
          </span>
        ))}
      </div>
    </div>
  );
}

// --- Unified Compare Charts ---

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

function classifyLcData(
  lcData: LapCenterPerformance[],
  profile: AthleteProfile,
): { date: string; speed: number; miss: number; type: "forest" | "sprint"; event: string }[] {
  const joyByDate = new Map<string, Array<{ type: "forest" | "sprint"; name: string }>>();
  for (const r of profile.rankings) {
    const t = r.type.includes("forest") ? ("forest" as const) : r.type.includes("sprint") ? ("sprint" as const) : null;
    if (!t) continue;
    for (const e of r.events) {
      if (!e.date) continue;
      if (!joyByDate.has(e.date)) joyByDate.set(e.date, []);
      const arr = joyByDate.get(e.date)!;
      if (!arr.some((x) => x.type === t)) arr.push({ type: t, name: e.eventName });
    }
  }

  const result: { date: string; speed: number; miss: number; type: "forest" | "sprint"; event: string }[] = [];
  for (const p of lcData) {
    const candidates = joyByDate.get(p.d);
    if (!candidates) continue;
    let type: "forest" | "sprint" | null = null;
    const types = new Set(candidates.map((c) => c.type));
    if (types.size === 1) {
      type = candidates[0].type;
    } else {
      for (const c of candidates) {
        if (eventFuzzyMatch(p.e, c.name)) { type = c.type; break; }
      }
    }
    if (!type) continue;
    result.push({ date: p.d, speed: p.s, miss: p.m, type, event: p.e });
  }
  return result;
}

type LcMode = "forest" | "sprint";
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

function linReg(arr: (number | undefined)[]): (number | undefined)[] {
  const pts = arr.map((v, i) => (v != null ? { x: i, y: v } : null)).filter((p): p is { x: number; y: number } => p != null);
  if (pts.length < 2) return new Array(arr.length).fill(undefined);
  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p.x, 0);
  const sy = pts.reduce((s, p) => s + p.y, 0);
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const sxx = pts.reduce((s, p) => s + p.x * p.x, 0);
  const a = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const b = (sy - a * sx) / n;
  const result: (number | undefined)[] = new Array(arr.length).fill(undefined);
  result[pts[0].x] = Math.round((a * pts[0].x + b) * 10) / 10;
  result[pts[n - 1].x] = Math.round((a * pts[n - 1].x + b) * 10) / 10;
  return result;
}

function CompareCharts({
  entries,
  profiles,
  lcAll,
}: {
  entries: (CompareEntry & { athlete: AthleteSummary })[];
  profiles: Map<string, AthleteProfile>;
  lcAll: Record<string, LapCenterPerformance[]> | null;
}) {
  const [mode, setMode] = useState<LcMode>("forest");
  const [chartRange, setChartRange] = useState<ChartRange>("2y");

  const cutoff = getChartCutoff(chartRange);

  // --- Score data (年齢別無差別のみ、Forest/Sprint切替) ---
  const { scoreData, scoreForestCount, scoreSprintCount } = useMemo(() => {
    const dateMap = new Map<string, Record<string, unknown>>();
    const forestDates = new Set<string>();
    const sprintDates = new Set<string>();
    for (const entry of entries) {
      const profile = profiles.get(entry.id);
      if (!profile) continue;
      for (const r of profile.rankings) {
        const isF = r.type === "age_forest" && (r.className === "無差別" || r.className === "女子無差別");
        const isS = r.type === "age_sprint" && (r.className === "S_無差別" || r.className === "S_女子無差別");
        if (!isF && !isS) continue;
        for (const e of r.events) {
          if (!e.date || (cutoff && e.date < cutoff)) continue;
          if (isF) forestDates.add(e.date);
          if (isS) sprintDates.add(e.date);
          // mode に応じたタイプのみチャートデータに追加
          if ((mode === "forest" && isF) || (mode === "sprint" && isS)) {
            if (!dateMap.has(e.date)) dateMap.set(e.date, { date: e.date });
            dateMap.get(e.date)![entry.id] = e.points;
          }
        }
      }
    }
    return {
      scoreData: [...dateMap.values()].sort((a, b) => (a.date as string).localeCompare(b.date as string)),
      scoreForestCount: forestDates.size,
      scoreSprintCount: sprintDates.size,
    };
  }, [entries, profiles, cutoff, mode]);

  const scoreDataWithTrend = useMemo(() => {
    if (scoreData.length < 2) return scoreData;
    const copy = scoreData.map((d) => ({ ...d }));
    for (const entry of entries) {
      const vals = copy.map((d) => d[entry.id] as number | undefined);
      const trend = linReg(vals);
      trend.forEach((v, i) => { if (v != null) copy[i][`sc_${entry.id}`] = v; });
    }
    return copy;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoreData, entries.map((e) => e.id).join(",")]);

  // --- LC data ---
  const athleteLcData = useMemo(() => {
    const result = new Map<string, ReturnType<typeof classifyLcData>>();
    if (!lcAll) return result;
    for (const entry of entries) {
      const lc = lcAll[entry.athlete.name];
      const profile = profiles.get(entry.id);
      if (!lc || !profile) continue;
      const classified = classifyLcData(lc, profile);
      result.set(entry.id, cutoff ? classified.filter((d) => d.date >= cutoff) : classified);
    }
    return result;
  }, [entries, profiles, lcAll, cutoff]);

  const lcEntriesWithData = entries.filter((e) => {
    const data = athleteLcData.get(e.id);
    return data && data.some((d) => d.type === mode);
  });

  const { lcForestCount, lcSprintCount } = useMemo(() => {
    const forestDates = new Set<string>();
    const sprintDates = new Set<string>();
    for (const [, data] of athleteLcData) {
      for (const d of data) {
        if (d.type === "forest") forestDates.add(d.date);
        else if (d.type === "sprint") sprintDates.add(d.date);
      }
    }
    return { lcForestCount: forestDates.size, lcSprintCount: sprintDates.size };
  }, [athleteLcData]);

  const speedData = useMemo(() => {
    const dateMap = new Map<string, Record<string, unknown>>();
    for (const entry of lcEntriesWithData) {
      const data = athleteLcData.get(entry.id);
      if (!data) continue;
      for (const d of data) {
        if (d.type !== mode) continue;
        if (!dateMap.has(d.date)) dateMap.set(d.date, { date: d.date });
        dateMap.get(d.date)![`s_${entry.id}`] = d.speed;
      }
    }
    return [...dateMap.values()].sort((a, b) => (a.date as string).localeCompare(b.date as string));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lcEntriesWithData.map((e) => e.id).join(","), athleteLcData, mode]);

  const missData = useMemo(() => {
    const dateMap = new Map<string, Record<string, unknown>>();
    for (const entry of lcEntriesWithData) {
      const data = athleteLcData.get(entry.id);
      if (!data) continue;
      for (const d of data) {
        if (d.type !== mode) continue;
        if (!dateMap.has(d.date)) dateMap.set(d.date, { date: d.date });
        dateMap.get(d.date)![`m_${entry.id}`] = d.miss;
      }
    }
    return [...dateMap.values()].sort((a, b) => (a.date as string).localeCompare(b.date as string));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lcEntriesWithData.map((e) => e.id).join(","), athleteLcData, mode]);

  const speedDataWithTrend = useMemo(() => {
    if (speedData.length < 2) return speedData;
    const copy = speedData.map((d) => ({ ...d }));
    for (const entry of lcEntriesWithData) {
      const vals = copy.map((d) => d[`s_${entry.id}`] as number | undefined);
      const trend = linReg(vals);
      trend.forEach((v, i) => { if (v != null) copy[i][`st_${entry.id}`] = v; });
    }
    return copy;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speedData, lcEntriesWithData.map((e) => e.id).join(",")]);

  const missDataWithTrend = useMemo(() => {
    if (missData.length < 2) return missData;
    const copy = missData.map((d) => ({ ...d }));
    for (const entry of lcEntriesWithData) {
      const vals = copy.map((d) => d[`m_${entry.id}`] as number | undefined);
      const trend = linReg(vals);
      trend.forEach((v, i) => { if (v != null) copy[i][`mt_${entry.id}`] = v; });
    }
    return copy;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missData, lcEntriesWithData.map((e) => e.id).join(",")]);

  const count = entries.length;
  const strokeW = count <= 3 ? 2 : count <= 5 ? 1.5 : 1;
  const dotR = count <= 3 ? 2 : count <= 5 ? 1.5 : 1;

  const lcStrokeW = lcEntriesWithData.length <= 3 ? 2 : lcEntriesWithData.length <= 5 ? 1.5 : 1;
  const lcDotR = lcEntriesWithData.length <= 3 ? 2 : lcEntriesWithData.length <= 5 ? 1.5 : 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lcTooltip = (unit: string) => ({ payload, label }: any) => {
    if (!payload?.length) return null;
    const active = (payload as Array<Record<string, unknown>>).filter(
      (p) => p.value != null && !(p.dataKey as string).startsWith("st_") && !(p.dataKey as string).startsWith("mt_"),
    );
    if (!active.length) return null;
    return (
      <div className="rounded-lg border border-white/10 bg-[#1a2332] px-3 py-2 text-xs shadow-xl">
        <p className="mb-1 text-muted">{label}</p>
        {active.map((p) => (
          <p key={p.dataKey as string} style={{ color: p.color as string }}>
            {p.name as string}: {Number(p.value).toFixed(1)}{unit}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      {/* Shared header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wider text-muted">パフォーマンス推移</h3>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-0.5">
            {CHART_RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setChartRange(r.value)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  chartRange === r.value ? "bg-primary/20 text-primary" : "text-muted hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setMode("forest")}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                mode === "forest" ? "bg-green-500/20 text-green-400" : "text-muted hover:text-foreground"
              }`}
            >
              <TreePine className="h-3 w-3" />
              Forest
            </button>
            <button
              onClick={() => setMode("sprint")}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                mode === "sprint" ? "bg-blue-500/20 text-blue-400" : "text-muted hover:text-foreground"
              }`}
            >
              <Zap className="h-3 w-3" />
              Sprint
            </button>
          </div>
          <div className="flex flex-wrap gap-2 text-[10px]">
            {entries.map((entry) => (
              <span key={entry.id} className="flex items-center gap-1" style={{ color: entry.color }}>
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                {profiles.get(entry.id)?.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Score chart */}
      {scoreData.length >= 2 && (
        <>
          <p className="mb-1 text-[10px] text-muted">
            スコア推移
            {scoreForestCount > 0 && <span className="ml-2 text-green-400">Forest ({scoreForestCount})</span>}
            {scoreSprintCount > 0 && <span className="ml-2 text-blue-400">Sprint ({scoreSprintCount})</span>}
          </p>
          <div className="h-48 overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={scoreDataWithTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v: string) => v.slice(5)} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} />
                <YAxis tick={{ fontSize: 10, fill: "#888" }} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} />
                <Tooltip
                  content={({ payload, label }) => {
                    if (!payload?.length) return null;
                    const active = (payload as Array<Record<string, unknown>>).filter(
                      (p) => p.value != null && !(p.dataKey as string).startsWith("sc_"),
                    );
                    if (!active.length) return null;
                    return (
                      <div className="rounded-lg border border-white/10 bg-[#1a2332] px-3 py-2 text-xs shadow-xl">
                        <p className="mb-1 text-muted">{label as string}</p>
                        {active.map((p) => (
                          <p key={p.dataKey as string} style={{ color: p.color as string }}>
                            {p.name as string}: {Number(p.value).toLocaleString()}
                          </p>
                        ))}
                      </div>
                    );
                  }}
                />
                {entries.map((entry) => (
                  <Line key={entry.id} name={profiles.get(entry.id)?.name ?? ""} type="monotone" dataKey={entry.id} stroke={entry.color} strokeWidth={strokeW} dot={{ r: dotR }} connectNulls />
                ))}
                {entries.map((entry) => (
                  <Line key={`sc_${entry.id}`} dataKey={`sc_${entry.id}`} stroke={entry.color} strokeWidth={1} strokeDasharray="6 3" dot={false} connectNulls legendType="none" />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Speed chart */}
      {speedData.length >= 2 && (
        <>
          <p className="mb-1 mt-4 text-[10px] text-muted">
            巡航速度
            {lcForestCount > 0 && <span className="ml-2 text-green-400">Forest ({lcForestCount})</span>}
            {lcSprintCount > 0 && <span className="ml-2 text-blue-400">Sprint ({lcSprintCount})</span>}
          </p>
          <div className="h-44 overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={speedDataWithTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v: string) => v.slice(5)} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "#888" }} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} />
                <Tooltip content={lcTooltip("")} />
                {lcEntriesWithData.map((entry) => (
                  <Line key={entry.id} name={profiles.get(entry.id)?.name ?? ""} type="monotone" dataKey={`s_${entry.id}`} stroke={entry.color} strokeWidth={lcStrokeW} dot={{ r: lcDotR }} connectNulls />
                ))}
                {lcEntriesWithData.map((entry) => (
                  <Line key={`st_${entry.id}`} dataKey={`st_${entry.id}`} stroke={entry.color} strokeWidth={1} strokeDasharray="6 3" dot={false} connectNulls legendType="none" />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Miss chart */}
      {missData.length >= 2 && (
        <>
          <p className="mb-1 mt-4 text-[10px] text-muted">ミス率 (%)</p>
          <div className="h-44 overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={missDataWithTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v: string) => v.slice(5)} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} />
                <YAxis domain={[0, "auto"]} tick={{ fontSize: 10, fill: "#888" }} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} />
                <Tooltip content={lcTooltip("%")} />
                {lcEntriesWithData.map((entry) => (
                  <Line key={entry.id} name={profiles.get(entry.id)?.name ?? ""} type="monotone" dataKey={`m_${entry.id}`} stroke={entry.color} strokeWidth={lcStrokeW} dot={{ r: lcDotR }} connectNulls />
                ))}
                {lcEntriesWithData.map((entry) => (
                  <Line key={`mt_${entry.id}`} dataKey={`mt_${entry.id}`} stroke={entry.color} strokeWidth={1} strokeDasharray="6 3" dot={false} connectNulls legendType="none" />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {scoreData.length < 2 && speedData.length < 2 && missData.length < 2 && (
        <p className="py-6 text-center text-sm text-muted">
          十分なデータがありません
        </p>
      )}
    </div>
  );
}
