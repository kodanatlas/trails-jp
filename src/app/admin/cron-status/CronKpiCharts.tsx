"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { CronJobName, CronLogRow } from "@/lib/cron-status";

interface Props {
  dataByJob: { job: CronJobName; rows: CronLogRow[] }[];
}

interface ChartPoint {
  date: string; // MM/DD HH:mm (JST)
  [key: string]: number | string | null;
}

const COLORS = {
  primary: "#f97316",
  accent: "#00e5ff",
  green: "#4ade80",
  purple: "#c084fc",
};

function formatJstShort(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** sync-events: events.count と lapcenter.matched の推移 */
function buildEventsData(rows: CronLogRow[]): ChartPoint[] {
  // 古い順（左→右が時系列）
  return [...rows].reverse().map((r) => {
    const result = (r.result ?? {}) as Record<string, unknown>;
    const events = result.events as { count?: number } | undefined;
    const lc = result.lapcenter as { matched?: number } | undefined;
    return {
      date: formatJstShort(r.created_at),
      events: events?.count ?? null,
      lc_matched: lc?.matched ?? null,
    };
  });
}

/** sync-lapcenter: matching.new_matches と runners.tracked_runners の推移 */
function buildLapCenterData(rows: CronLogRow[]): ChartPoint[] {
  return [...rows].reverse().map((r) => {
    const result = (r.result ?? {}) as Record<string, unknown>;
    const matching = result.matching as { new_matches?: number } | undefined;
    const runners = result.runners as { tracked_runners?: number } | null | undefined;
    return {
      date: formatJstShort(r.created_at),
      new_matches: matching?.new_matches ?? null,
      tracked_runners: runners?.tracked_runners ?? null,
    };
  });
}

export function CronKpiCharts({ dataByJob }: Props) {
  const eventsData = useMemo(() => {
    const rows = dataByJob.find((d) => d.job === "sync-events")?.rows ?? [];
    return buildEventsData(rows);
  }, [dataByJob]);
  const lcData = useMemo(() => {
    const rows = dataByJob.find((d) => d.job === "sync-lapcenter")?.rows ?? [];
    return buildLapCenterData(rows);
  }, [dataByJob]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard title="sync-events: イベント件数 / LCマッチ数">
        {eventsData.length === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={eventsData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: "#8a9bb0", fontSize: 10 }} />
              <YAxis tick={{ fill: "#8a9bb0", fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  background: "#1a2332",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="events"
                name="events.count"
                stroke={COLORS.primary}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="lc_matched"
                name="lapcenter.matched"
                stroke={COLORS.accent}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="sync-lapcenter: 新規マッチ / 追跡ランナー(水曜)">
        {lcData.length === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={lcData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: "#8a9bb0", fontSize: 10 }} />
              <YAxis tick={{ fill: "#8a9bb0", fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  background: "#1a2332",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="new_matches"
                name="matching.new_matches"
                stroke={COLORS.green}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="tracked_runners"
                name="runners.tracked_runners"
                stroke={COLORS.purple}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 text-xs font-semibold text-muted">{title}</div>
      {children}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[220px] items-center justify-center text-xs text-muted">
      データなし
    </div>
  );
}
