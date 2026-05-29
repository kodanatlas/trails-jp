import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Activity, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  assessJobHealth,
  formatAge,
  formatJst,
  healthColors,
  JOB_CONFIG,
  type CronJobName,
  type CronLogRow,
  type JobAssessment,
} from "@/lib/cron-status";
import { CronKpiCharts } from "./CronKpiCharts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Cron稼働状況",
  description: "trails.jp の Cron ジョブ稼働状況",
  robots: { index: false, follow: false },
};

const HISTORY_LIMIT = 30;
const JOB_NAMES: CronJobName[] = ["sync-events", "sync-lapcenter"];

async function fetchRecent(job: CronJobName): Promise<CronLogRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from("cron_log")
    .select("id, job_name, status, result, duration_ms, created_at")
    .eq("job_name", job)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) {
    console.error(`cron_log fetch failed for ${job}:`, error.message);
    return [];
  }
  return (data ?? []) as CronLogRow[];
}

export default async function CronStatusPage() {
  const now = new Date();
  const dataByJob = await Promise.all(
    JOB_NAMES.map(async (job) => ({
      job,
      rows: await fetchRecent(job),
    })),
  );

  const assessments = dataByJob.map(({ job, rows }) => ({
    job,
    rows,
    assessment: assessJobHealth(job, rows, now),
  }));

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">Cron稼働状況</h1>
        <p className="mt-4 text-sm text-red-400">
          Supabase が未設定です。環境変数 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を確認してください。
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        トップに戻る
      </Link>

      <div className="flex items-center gap-3">
        <Activity className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Cron稼働状況</h1>
      </div>
      <p className="mt-2 text-sm text-muted">
        Vercel Cron ジョブ ({JOB_NAMES.length}本) の実行履歴と健康状態。
        ページ最終取得: {formatJst(now.toISOString())} JST
      </p>

      {/* ---- ジョブ別カード ---- */}
      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        {assessments.map(({ job, assessment }) => (
          <JobCard key={job} assessment={assessment} />
        ))}
      </section>

      {/* ---- KPI 時系列 ---- */}
      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold">KPI推移（直近{HISTORY_LIMIT}件）</h2>
        <CronKpiCharts dataByJob={dataByJob} />
      </section>

      {/* ---- 履歴テーブル ---- */}
      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold">実行履歴（直近{HISTORY_LIMIT}件）</h2>
        <div className="space-y-8">
          {dataByJob.map(({ job, rows }) => (
            <HistoryTable key={job} job={job} rows={rows} />
          ))}
        </div>
      </section>
    </div>
  );
}

function JobCard({ assessment }: { assessment: JobAssessment }) {
  const c = healthColors(assessment.overall);
  const cfg = JOB_CONFIG[assessment.job];
  const latest = assessment.latest;
  const Icon = assessment.overall === "green" ? CheckCircle2 : AlertCircle;

  return (
    <div className={`rounded-xl border ${c.border} ${c.bg} p-5`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted">{cfg.label}</div>
          <div className="mt-0.5 font-mono text-sm font-semibold">{assessment.job}</div>
          <div className="mt-0.5 text-[11px] text-muted">
            実行スケジュール: 毎日 {String(cfg.runHourJst).padStart(2, "0")}:00 JST
          </div>
        </div>
        <div className={`flex items-center gap-1.5 ${c.text}`}>
          <Icon className="h-5 w-5" />
          <span className="text-sm font-semibold">{c.label}</span>
        </div>
      </div>

      <div className="mt-4 space-y-1.5 text-xs">
        <Row label="最終実行">
          {latest ? (
            <span>
              {formatJst(latest.created_at)}
              <span className="ml-2 text-muted">({formatAge(assessment.ageMs)})</span>
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </Row>
        <Row label="ステータス">
          <span className={latest?.status === "success" ? "text-green-400" : "text-red-400"}>
            {latest?.status ?? "—"}
          </span>
        </Row>
        <Row label="実行時間">
          <span>{latest?.duration_ms != null ? `${latest.duration_ms} ms` : "—"}</span>
        </Row>
        {assessment.lastSuccess && assessment.lastSuccess.id !== latest?.id && (
          <Row label="直近の成功">
            <span className="text-muted">{formatJst(assessment.lastSuccess.created_at)}</span>
          </Row>
        )}
      </div>

      {assessment.reasons.length > 0 && (
        <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-muted">
          <div className={`mb-1 font-semibold ${c.text}`}>判定理由</div>
          <ul className="list-inside list-disc space-y-0.5">
            {assessment.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function HistoryTable({ job, rows }: { job: CronJobName; rows: CronLogRow[] }) {
  return (
    <div>
      <div className="mb-2 font-mono text-xs font-semibold text-muted">{job}</div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface text-muted">
            <tr>
              <th className="px-3 py-2 text-left">実行時刻 (JST)</th>
              <th className="px-3 py-2 text-left">ステータス</th>
              <th className="px-3 py-2 text-right">実行時間</th>
              <th className="px-3 py-2 text-left">サマリ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-muted">
                  履歴なし
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="whitespace-nowrap px-3 py-1.5">{formatJst(r.created_at)}</td>
                <td className="px-3 py-1.5">
                  <span
                    className={
                      r.status === "success"
                        ? "rounded bg-green-500/10 px-1.5 py-0.5 text-green-400"
                        : "rounded bg-red-500/10 px-1.5 py-0.5 text-red-400"
                    }
                  >
                    {r.status}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-muted">
                  {r.duration_ms != null ? `${r.duration_ms} ms` : "—"}
                </td>
                <td className="px-3 py-1.5 text-muted">{summarizeResult(job, r.result)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** result jsonb から人間可読な1行サマリを生成 */
function summarizeResult(job: CronJobName, result: unknown): string {
  if (!result || typeof result !== "object") return "—";
  const r = result as Record<string, unknown>;

  if (r.error) return `error: ${String(r.error).slice(0, 80)}`;

  if (job === "sync-events") {
    const events = r.events as { count?: number } | undefined;
    const lc = r.lapcenter as { matched?: number; total?: number } | undefined;
    const deploy = r.deploy as { triggered?: boolean } | null | undefined;
    const parts: string[] = [];
    if (events?.count != null) parts.push(`events=${events.count}`);
    if (lc?.matched != null && lc?.total != null) parts.push(`lc=${lc.matched}/${lc.total}`);
    if (deploy?.triggered) parts.push("deploy=triggered");
    return parts.join(" / ") || "—";
  }

  if (job === "sync-lapcenter") {
    const m = r.matching as
      | { new_matches?: number; total_matched?: number; total_events?: number }
      | undefined;
    const runners = r.runners as
      | { tracked_runners?: number; events_processed?: number; error?: string }
      | null
      | undefined;
    const parts: string[] = [];
    if (m?.new_matches != null) parts.push(`new=${m.new_matches}`);
    if (m?.total_matched != null && m?.total_events != null)
      parts.push(`matched=${m.total_matched}/${m.total_events}`);
    if (runners?.tracked_runners != null) parts.push(`runners=${runners.tracked_runners}`);
    if (runners?.error) parts.push(`runners.error`);
    return parts.join(" / ") || "—";
  }

  return "—";
}
