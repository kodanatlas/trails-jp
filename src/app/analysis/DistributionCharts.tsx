"use client";

import { useMemo } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, ZAxis, ReferenceLine, ReferenceDot, Label,
} from "recharts";
import type { AthleteIndex, AthleteSummary, ClubIndex } from "@/lib/analysis/types";

const TYPE_COLORS: Record<string, string> = {
  forester: "#4ade80",
  sprinter: "#60a5fa",
  allrounder: "#c084fc",
  unknown: "#666",
};

/** 選手分布: Forest vs Sprint ポイント散布図 */
export function AthleteDistribution({
  athleteIndex,
  selectedAthlete,
}: {
  athleteIndex: AthleteIndex;
  selectedAthlete: AthleteSummary | null;
}) {
  const { data, selectedPoint } = useMemo(() => {
    const points: {
      name: string;
      forest: number;
      sprint: number;
      type: string;
      isSelected: boolean;
    }[] = [];
    let sel: { forest: number; sprint: number; name: string } | null = null;

    for (const a of Object.values(athleteIndex.athletes)) {
      const fApps = a.appearances.filter((r) => r.type.includes("forest"));
      const sApps = a.appearances.filter((r) => r.type.includes("sprint"));
      if (fApps.length === 0 || sApps.length === 0) continue;

      const fPts = Math.max(...fApps.map((r) => r.totalPoints));
      const sPts = Math.max(...sApps.map((r) => r.totalPoints));
      const isSelected = selectedAthlete?.name === a.name;

      points.push({
        name: a.name,
        forest: Math.round(fPts),
        sprint: Math.round(sPts),
        type: a.type,
        isSelected,
      });

      if (isSelected) sel = { forest: Math.round(fPts), sprint: Math.round(sPts), name: a.name };
    }

    return { data: points, selectedPoint: sel };
  }, [athleteIndex, selectedAthlete]);

  // Type counts for legend
  const typeCounts = useMemo(() => {
    const counts = { forester: 0, sprinter: 0, allrounder: 0 };
    for (const d of data) {
      if (d.type in counts) counts[d.type as keyof typeof counts]++;
    }
    return counts;
  }, [data]);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
          Forest vs Sprint 分布
        </h3>
        <span className="text-[10px] text-muted">{data.length}名</span>
      </div>

      {/* Legend */}
      <div className="mb-3 flex flex-wrap gap-3 text-[10px]">
        {([
          { type: "forester", label: "フォレスター" },
          { type: "sprinter", label: "スプリンター" },
          { type: "allrounder", label: "オールラウンダー" },
        ] as const).map((t) => (
          <span key={t.type} className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: TYPE_COLORS[t.type] }}
            />
            <span className="text-muted">{t.label}</span>
            <span className="font-bold" style={{ color: TYPE_COLORS[t.type] }}>
              {typeCounts[t.type]}
            </span>
          </span>
        ))}
      </div>

      <div className="h-64 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 5, right: 10, bottom: 25, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              type="number"
              dataKey="forest"
              name="Forest"
              tick={{ fontSize: 10, fill: "#888" }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              label={{ value: "Forest ポイント", position: "bottom", fontSize: 10, fill: "#4ade80", offset: 10 }}
            />
            <YAxis
              type="number"
              dataKey="sprint"
              name="Sprint"
              tick={{ fontSize: 10, fill: "#888" }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              label={{ value: "Sprint ポイント", angle: -90, position: "insideLeft", fontSize: 10, fill: "#60a5fa", offset: 10 }}
            />
            <ZAxis range={[15, 15]} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1a2332",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                fontSize: 12,
              }}
              content={({ payload }) => {
                if (!payload?.[0]?.payload) return null;
                const d = payload[0].payload;
                return (
                  <div className="rounded-lg border border-white/10 bg-[#1a2332] px-3 py-2 text-xs shadow-xl">
                    <p className="font-bold">{d.name}</p>
                    <p className="text-green-400">Forest: {d.forest.toLocaleString()}</p>
                    <p className="text-blue-400">Sprint: {d.sprint.toLocaleString()}</p>
                  </div>
                );
              }}
            />
            {/* Crosshair lines for selected athlete */}
            {selectedPoint && (
              <>
                <ReferenceLine
                  x={selectedPoint.forest}
                  stroke="#fbbf24"
                  strokeDasharray="4 4"
                  strokeOpacity={0.6}
                />
                <ReferenceLine
                  y={selectedPoint.sprint}
                  stroke="#fbbf24"
                  strokeDasharray="4 4"
                  strokeOpacity={0.6}
                >
                  <Label
                    value={selectedPoint.name}
                    position="insideTopRight"
                    fill="#fbbf24"
                    fontSize={11}
                    fontWeight="bold"
                    offset={8}
                  />
                </ReferenceLine>
              </>
            )}
            <Scatter data={data} shape="circle">
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.isSelected ? "#fbbf24" : TYPE_COLORS[entry.type] ?? "#666"}
                  fillOpacity={entry.isSelected ? 1 : selectedPoint ? 0.15 : 0.4}
                  stroke={entry.isSelected ? "#fbbf24" : "none"}
                  strokeWidth={entry.isSelected ? 3 : 0}
                  r={entry.isSelected ? 8 : undefined}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-center text-[9px] text-muted">
        対角線より上 = Sprint寄り、下 = Forest寄り（Forest・Sprint両方にランクインしている選手のみ）
      </p>
    </div>
  );
}

/** クラブ分布: メンバー数 vs 平均ポイント散布図 */
export function ClubDistribution({
  clubIndex,
  expandedClub,
}: {
  clubIndex: ClubIndex;
  expandedClub: string | null;
}) {
  const data = useMemo(() => {
    return Object.values(clubIndex.clubs)
      .filter((c) => c.memberCount >= 2) // 2名以上のクラブのみ
      .map((c) => {
        const totalType = c.forestCount + c.sprintCount;
        const forestRatio = totalType > 0 ? c.forestCount / totalType : 0.5;
        return {
          name: c.name,
          members: c.memberCount,
          avgPoints: Math.round(c.avgPoints),
          active: c.activeCount,
          forestRatio,
          isSelected: c.name === expandedClub,
        };
      });
  }, [clubIndex, expandedClub]);

  // Show labels for clubs that don't overlap, prioritized by avgPoints
  const labeledClubs = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.avgPoints - a.avgPoints);
    const placed: { members: number; avgPoints: number }[] = [];
    const result: typeof data = [];

    // Normalize thresholds relative to data range
    const maxMembers = Math.max(...data.map((d) => d.members), 1);
    const maxPts = Math.max(...data.map((d) => d.avgPoints), 1);

    for (const club of sorted) {
      const nx = club.members / maxMembers;
      const ny = club.avgPoints / maxPts;
      const tooClose = placed.some((p) => {
        const px = p.members / maxMembers;
        const py = p.avgPoints / maxPts;
        return Math.abs(nx - px) < 0.12 && Math.abs(ny - py) < 0.08;
      });
      if (!tooClose) {
        placed.push(club);
        result.push(club);
      }
      if (result.length >= 15) break;
    }
    return result;
  }, [data]);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
          クラブ分布
        </h3>
        <span className="text-[10px] text-muted">{data.length} クラブ（2名以上）</span>
      </div>
      <p className="mb-3 text-[10px] text-muted">
        横軸: 所属人数、縦軸: 平均ポイント、色: Forest↔Sprint比率
      </p>

      <div className="h-64 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 5, right: 10, bottom: 25, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              type="number"
              dataKey="members"
              name="メンバー数"
              tick={{ fontSize: 10, fill: "#888" }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              label={{ value: "所属人数", position: "bottom", fontSize: 10, fill: "#888", offset: 10 }}
            />
            <YAxis
              type="number"
              dataKey="avgPoints"
              name="平均ポイント"
              tick={{ fontSize: 10, fill: "#888" }}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              label={{ value: "平均ポイント", angle: -90, position: "insideLeft", fontSize: 10, fill: "#888", offset: 10 }}
            />
            <ZAxis type="number" dataKey="active" range={[30, 200]} name="アクティブ" />
            <Tooltip
              content={({ payload }) => {
                if (!payload?.[0]?.payload) return null;
                const d = payload[0].payload;
                return (
                  <div className="rounded-lg border border-white/10 bg-[#1a2332] px-3 py-2 text-xs shadow-xl">
                    <p className="font-bold">{d.name}</p>
                    <p className="text-muted">{d.members}名 (アクティブ {d.active}名)</p>
                    <p className="text-primary">平均: {d.avgPoints.toLocaleString()} pts</p>
                    <div className="mt-1 flex h-1.5 w-24 overflow-hidden rounded-full">
                      <div className="bg-green-500/70" style={{ width: `${d.forestRatio * 100}%` }} />
                      <div className="bg-blue-500/70" style={{ width: `${(1 - d.forestRatio) * 100}%` }} />
                    </div>
                  </div>
                );
              }}
            />
            <Scatter data={data} shape="circle">
              {data.map((entry, i) => {
                // Green (forest) ↔ Blue (sprint) gradient based on ratio
                const r = Math.round(74 + (96 - 74) * (1 - entry.forestRatio));
                const g = Math.round(222 + (165 - 222) * (1 - entry.forestRatio));
                const b = Math.round(128 + (250 - 128) * (1 - entry.forestRatio));
                const color = `rgb(${r},${g},${b})`;
                return (
                  <Cell
                    key={i}
                    fill={entry.isSelected ? "#fff" : color}
                    fillOpacity={entry.isSelected ? 1 : 0.6}
                    stroke={entry.isSelected ? "#fff" : "none"}
                    strokeWidth={entry.isSelected ? 2 : 0}
                  />
                );
              })}
            </Scatter>
            {labeledClubs.map((c) => (
              <ReferenceDot
                key={c.name}
                x={c.members}
                y={c.avgPoints}
                r={0}
                fill="none"
                stroke="none"
              >
                <Label
                  value={c.name}
                  position="top"
                  fill={c.isSelected ? "#fff" : "rgba(255,255,255,0.55)"}
                  fontSize={9}
                  fontWeight={c.isSelected ? "bold" : "normal"}
                  offset={6}
                />
              </ReferenceDot>
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex justify-center gap-4 text-[9px] text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-green-400" /> Forest寄り
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-400" /> Sprint寄り
        </span>
        <span>ドットサイズ = アクティブ人数</span>
      </div>
    </div>
  );
}
