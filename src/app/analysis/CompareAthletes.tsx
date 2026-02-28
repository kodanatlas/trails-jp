"use client";

import { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Search, X, Loader2 } from "lucide-react";
import type { AthleteIndex, AthleteSummary, AthleteProfile } from "@/lib/analysis/types";
import {
  loadAthleteDetail,
  calcConsistency,
  calcRecentForm,
  getAllEvents,
  typeLabel,
  getBestRanks,
} from "@/lib/analysis/utils";

interface Props {
  athleteIndex: AthleteIndex;
  compareA: AthleteSummary | null;
  compareB: AthleteSummary | null;
  onSelectA: (a: AthleteSummary | null) => void;
  onSelectB: (b: AthleteSummary | null) => void;
}

export function CompareAthletes({ athleteIndex, compareA, compareB, onSelectA, onSelectB }: Props) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <AthleteSearchSlot
          label="選手A"
          color="#00e5ff"
          athleteIndex={athleteIndex}
          selected={compareA}
          onSelect={onSelectA}
        />
        <AthleteSearchSlot
          label="選手B"
          color="#f97316"
          athleteIndex={athleteIndex}
          selected={compareB}
          onSelect={onSelectB}
        />
      </div>

      {compareA && compareB && (
        <CompareView a={compareA} b={compareB} />
      )}

      {(!compareA || !compareB) && (
        <div className="rounded-lg border border-border bg-card py-12 text-center text-sm text-muted">
          2名の選手を選択して比較を開始
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
}: {
  label: string;
  color: string;
  athleteIndex: AthleteIndex;
  selected: AthleteSummary | null;
  onSelect: (a: AthleteSummary | null) => void;
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
          <div>
            <p className="text-[10px] font-medium" style={{ color }}>{label}</p>
            <p className="text-sm font-bold">{selected.name}</p>
            <p className="text-[10px] text-muted">{selected.clubs.join(" / ")}</p>
          </div>
          <button
            onClick={() => { onSelect(null); setQuery(""); }}
            className="rounded-full p-1 text-muted hover:bg-white/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="rounded-lg border border-border p-3">
        <p className="mb-1.5 text-[10px] font-medium" style={{ color }}>{label}</p>
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

function CompareView({ a, b }: { a: AthleteSummary; b: AthleteSummary }) {
  const [profileA, setProfileA] = useState<AthleteProfile | null>(null);
  const [profileB, setProfileB] = useState<AthleteProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadAthleteDetail(a), loadAthleteDetail(b)]).then(([pa, pb]) => {
      setProfileA(pa);
      setProfileB(pb);
      setLoading(false);
    });
  }, [a, b]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted">比較データを読み込み中...</span>
      </div>
    );
  }

  if (!profileA || !profileB) return null;

  const eventsA = getAllEvents(profileA);
  const eventsB = getAllEvents(profileB);
  const consistencyA = calcConsistency(eventsA);
  const consistencyB = calcConsistency(eventsB);
  const formA = calcRecentForm(eventsA);
  const formB = calcRecentForm(eventsB);
  const ranksA = getBestRanks(profileA.appearances);
  const ranksB = getBestRanks(profileB.appearances);

  return (
    <div className="space-y-4">
      {/* Side-by-side stats */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          スタッツ比較
        </h3>
        <div className="space-y-3">
          <CompareRow label="最高ポイント" valueA={profileA.bestPoints.toLocaleString(undefined, { maximumFractionDigits: 1 })} valueB={profileB.bestPoints.toLocaleString(undefined, { maximumFractionDigits: 1 })} highlightA={profileA.bestPoints >= profileB.bestPoints} />
          <CompareRow label="最高ランク" valueA={`${profileA.bestRank}位`} valueB={`${profileB.bestRank}位`} highlightA={profileA.bestRank <= profileB.bestRank} />
          <CompareRow label="安定性" valueA={`${consistencyA}/100`} valueB={`${consistencyB}/100`} highlightA={consistencyA >= consistencyB} />
          <CompareRow label="最近の調子" valueA={`${formA > 0 ? "+" : ""}${formA}%`} valueB={`${formB > 0 ? "+" : ""}${formB}%`} highlightA={formA >= formB} />
          <CompareRow label="特性" valueA={typeLabel(profileA.type)} valueB={typeLabel(profileB.type)} />
          <CompareRow label="Forest 最高" valueA={ranksA.forestRank !== null ? `${ranksA.forestRank}位` : "—"} valueB={ranksB.forestRank !== null ? `${ranksB.forestRank}位` : "—"} highlightA={ranksA.forestRank !== null && (ranksB.forestRank === null || ranksA.forestRank <= ranksB.forestRank)} />
          <CompareRow label="Sprint 最高" valueA={ranksA.sprintRank !== null ? `${ranksA.sprintRank}位` : "—"} valueB={ranksB.sprintRank !== null ? `${ranksB.sprintRank}位` : "—"} highlightA={ranksA.sprintRank !== null && (ranksB.sprintRank === null || ranksA.sprintRank <= ranksB.sprintRank)} />
        </div>
      </div>

      {/* Overlay Chart */}
      <CompareChart profileA={profileA} profileB={profileB} />
    </div>
  );
}

function CompareRow({
  label,
  valueA,
  valueB,
  highlightA,
}: {
  label: string;
  valueA: string;
  valueB: string;
  highlightA?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`w-24 text-right font-mono font-bold ${highlightA === true ? "text-[#00e5ff]" : highlightA === false ? "text-muted" : ""}`}>
        {valueA}
      </span>
      <span className="flex-1 text-center text-[10px] text-muted">{label}</span>
      <span className={`w-24 font-mono font-bold ${highlightA === false ? "text-[#f97316]" : highlightA === true ? "text-muted" : ""}`}>
        {valueB}
      </span>
    </div>
  );
}

function CompareChart({ profileA, profileB }: { profileA: AthleteProfile; profileB: AthleteProfile }) {
  const eventsA = useMemo(() => getAllEvents(profileA), [profileA]);
  const eventsB = useMemo(() => getAllEvents(profileB), [profileB]);

  // Merge into a single timeline by date
  const chartData = useMemo(() => {
    const dateMap = new Map<string, { date: string; a?: number; b?: number; nameA?: string; nameB?: string }>();

    for (const e of eventsA) {
      if (!dateMap.has(e.date)) dateMap.set(e.date, { date: e.date });
      const d = dateMap.get(e.date)!;
      d.a = e.points;
      d.nameA = e.eventName;
    }
    for (const e of eventsB) {
      if (!dateMap.has(e.date)) dateMap.set(e.date, { date: e.date });
      const d = dateMap.get(e.date)!;
      d.b = e.points;
      d.nameB = e.eventName;
    }

    return [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [eventsA, eventsB]);

  if (chartData.length < 2) {
    return (
      <div className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted">
        比較チャートに十分なデータがありません
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
        スコア推移比較
      </h3>
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
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              formatter={(value) => value}
            />
            <Line
              name={profileA.name}
              type="monotone"
              dataKey="a"
              stroke="#00e5ff"
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls
            />
            <Line
              name={profileB.name}
              type="monotone"
              dataKey="b"
              stroke="#f97316"
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
