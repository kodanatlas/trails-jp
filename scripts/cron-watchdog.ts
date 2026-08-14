import { pathToFileURL } from "node:url";

/**
 * 日次 cron は「最新が成功した」だけでは欠測を検知できないため、7日分の履歴も同時に監視する。
 * 取得と判定を分離し、judge には時刻も注入することで、監視ロジックを実時間・ネットワークから独立させる。
 *
 * Supabase の anon key は環境変数からのみ受け取り、URL・診断ログには含めない。
 */

export const MAX_AGE_H = 26;
export const MAX_GAP_H = 26;
export const HISTORY_DAYS = 7;
export const ROW_LIMIT = 20;
export const FAIL_COUNT_7D = 3;

const BASE_URL = "https://mlbyohpbembeoutaakkr.supabase.co";
const HOUR_MS = 60 * 60 * 1_000;
const HISTORY_MS = HISTORY_DAYS * 24 * HOUR_MS;
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_WAIT_MS = 20_000;
const MAX_ATTEMPTS = 3;

export const JOBS = [
  "sync-events",
  "sync-entries",
  "sync-lapcenter",
] as const;

export type JobName = (typeof JOBS)[number];

export type ResourceResult =
  | { ok: true; rows: readonly unknown[] }
  | { ok: false; detail: string };

export type JudgeInput = {
  cronLogs: Readonly<Record<JobName, ResourceResult>>;
  lcPerformances: ResourceResult;
};

export type Diagnostic = {
  category: "A" | "A2" | "B" | "B2" | "D";
  job: JobName | "lc_performances";
  message: string;
};

export type JudgeResult = {
  ok: boolean;
  diagnostics: readonly Diagnostic[];
  summaries: readonly string[];
  lcPerformanceSummary: string;
};

type ParsedCronRow = {
  createdAt: string;
  createdAtMs: number;
  status: unknown;
  result: unknown;
};

type ParsedRows = {
  rows: readonly ParsedCronRow[];
  diagnostics: readonly Diagnostic[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCreatedAt(value: string): number {
  return Date.parse(value);
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function parseCronRows(job: JobName, values: readonly unknown[]): ParsedRows {
  const parsed = values.map((value, index) => {
    if (!isRecord(value) || typeof value.created_at !== "string") {
      return {
        row: null,
        diagnostic: {
          category: "D" as const,
          job,
          message: `cron_log row=${index} の created_at が文字列ではありません`,
        },
      };
    }

    const createdAtMs = parseCreatedAt(value.created_at);
    if (!Number.isFinite(createdAtMs)) {
      return {
        row: null,
        diagnostic: {
          category: "D" as const,
          job,
          message: `cron_log row=${index} の created_at を解釈できません (value=${value.created_at})`,
        },
      };
    }

    return {
      row: {
        createdAt: value.created_at,
        createdAtMs,
        status: value.status,
        result: value.result,
      },
      diagnostic: null,
    };
  });

  return {
    rows: parsed
      .flatMap(({ row }) => (row === null ? [] : [row]))
      .sort((left, right) => right.createdAtMs - left.createdAtMs),
    diagnostics: parsed.flatMap(({ diagnostic }) =>
      diagnostic === null ? [] : [diagnostic],
    ),
  };
}

function nestedError(result: Record<string, unknown>, key: string): boolean {
  const nested = result[key];
  return isRecord(nested) && nested.error !== null && nested.error !== undefined;
}

export function failureReasons(job: JobName, row: {
  status: unknown;
  result: unknown;
}): readonly string[] {
  const commonReasons = [
    ...(row.status === "success"
      ? []
      : [`status=${JSON.stringify(row.status) ?? "undefined"}`]),
    ...(isRecord(row.result)
      ? []
      : [`result=${describeValue(row.result)}`]),
  ];

  if (job !== "sync-lapcenter" || !isRecord(row.result)) {
    return commonReasons;
  }

  return [
    ...commonReasons,
    ...(row.result.runners === null || row.result.runners === undefined
      ? ["result.runners=missing"]
      : []),
    ...(nestedError(row.result, "runners")
      ? ["result.runners.error=present"]
      : []),
    ...(nestedError(row.result, "matching")
      ? ["result.matching.error=present"]
      : []),
  ];
}

function formatJst(timestampMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestampMs));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "??";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")} JST`;
}

function maximumGapHours(rows: readonly ParsedCronRow[]): number | null {
  if (rows.length < 2) return null;
  return rows.slice(0, -1).reduce((maximum, newer, index) => {
    const older = rows[index + 1];
    const gapHours = (newer.createdAtMs - older.createdAtMs) / HOUR_MS;
    return Math.max(maximum, gapHours);
  }, 0);
}

function statusLabel(status: unknown): string {
  return typeof status === "string" ? status : describeValue(status);
}

function judgeJob(
  job: JobName,
  resource: ResourceResult,
  nowMs: number,
): { diagnostics: readonly Diagnostic[]; summary: string | null } {
  if (!resource.ok) {
    return {
      diagnostics: [{ category: "D", job, message: resource.detail }],
      summary: null,
    };
  }

  if (resource.rows.length === 0) {
    return {
      diagnostics: [
        { category: "A", job, message: "cron_log rows=0" },
      ],
      summary: null,
    };
  }

  const parsed = parseCronRows(job, resource.rows.slice(0, ROW_LIMIT));
  if (parsed.rows.length === 0) {
    return { diagnostics: parsed.diagnostics, summary: null };
  }

  const latest = parsed.rows[0];
  const ageHours = (nowMs - latest.createdAtMs) / HOUR_MS;
  const historyStartMs = nowMs - HISTORY_MS;
  const recentRows = parsed.rows.filter(
    (row) => row.createdAtMs >= historyStartMs,
  );
  const rowBeforeHistory = parsed.rows.find(
    (row) => row.createdAtMs < historyStartMs,
  );
  // 復旧直後の窓境界をまたぐ欠測を拾うため、A2 だけは窓の直前を1行参照する。
  // サマリの max_gap_h と B2 は従来どおり7日窓内だけを集計する。
  const gapRows =
    rowBeforeHistory === undefined
      ? recentRows
      : [...recentRows, rowBeforeHistory];
  const maxGapHours = maximumGapHours(recentRows);
  const latestTwo = parsed.rows.slice(0, 2);
  const latestTwoFailures = latestTwo.map((row) => failureReasons(job, row));
  const failedRecent = recentRows.filter(
    (row) => failureReasons(job, row).length > 0,
  );

  const ageDiagnostics: readonly Diagnostic[] =
    ageHours > MAX_AGE_H
      ? [
          {
            category: "A",
            job,
            message: `latest=${latest.createdAt} age_h=${ageHours.toFixed(3)} max_age_h=${MAX_AGE_H}`,
          },
        ]
      : [];

  const gapDiagnostics: readonly Diagnostic[] = gapRows
    .slice(0, -1)
    .flatMap((newer, index) => {
      // 過去の欠測を無期限に報告しないよう、新しい側が7日窓内の gap だけを評価する。
      if (newer.createdAtMs < historyStartMs) return [];
      const older = gapRows[index + 1];
      const gapHours = (newer.createdAtMs - older.createdAtMs) / HOUR_MS;
      return gapHours > MAX_GAP_H
        ? [
            {
              category: "A2" as const,
              job,
              message: `newer=${newer.createdAt} older=${older.createdAt} gap_h=${gapHours.toFixed(3)} max_gap_h=${MAX_GAP_H}`,
            },
          ]
        : [];
    });

  const consecutiveDiagnostics: readonly Diagnostic[] =
    latestTwoFailures.length === 2 &&
    latestTwoFailures.every((reasons) => reasons.length > 0)
      ? [
          {
            category: "B",
            job,
            message: `latest_two_failed=true reasons=[${latestTwoFailures
              .map((reasons) => reasons.join(","))
              .join(" / ")}]`,
          },
        ]
      : [];

  const frequentFailureDiagnostics: readonly Diagnostic[] =
    failedRecent.length >= FAIL_COUNT_7D
      ? [
          {
            category: "B2",
            job,
            message: `failures_7d=${failedRecent.length} threshold=${FAIL_COUNT_7D} runs_7d=${recentRows.length}`,
          },
        ]
      : [];

  return {
    diagnostics: [
      ...parsed.diagnostics,
      ...ageDiagnostics,
      ...gapDiagnostics,
      ...consecutiveDiagnostics,
      ...frequentFailureDiagnostics,
    ],
    summary: `[OK] job=${job} latest=${formatJst(latest.createdAtMs)} status=${statusLabel(latest.status)} runs_7d=${recentRows.length} max_gap_h=${maxGapHours === null ? "n/a" : maxGapHours.toFixed(3)}`,
  };
}

function lcPerformanceSummary(resource: ResourceResult): string {
  if (!resource.ok) return "[INFO] lc_performances latest_event_date=unavailable";
  if (resource.rows.length === 0) return "[INFO] lc_performances latest_event_date=none";
  const first = resource.rows[0];
  const eventDate = isRecord(first) ? first.event_date : undefined;
  return `[INFO] lc_performances latest_event_date=${typeof eventDate === "string" ? eventDate : "unknown"}`;
}

export function judge(input: JudgeInput, nowMs: number): JudgeResult {
  const jobResults = JOBS.map((job) =>
    judgeJob(job, input.cronLogs[job], nowMs),
  );
  const lcDiagnostics: readonly Diagnostic[] = input.lcPerformances.ok
    ? []
    : [
        {
          category: "D",
          job: "lc_performances",
          message: input.lcPerformances.detail,
        },
      ];
  const diagnostics = [
    ...jobResults.flatMap((result) => result.diagnostics),
    ...lcDiagnostics,
  ];

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    summaries: jobResults.flatMap(({ summary }) =>
      summary === null ? [] : [summary],
    ),
    lcPerformanceSummary: lcPerformanceSummary(input.lcPerformances),
  };
}

export function decodeResponse(status: number, body: string): ResourceResult {
  if (status < 200 || status >= 300) {
    return { ok: false, detail: `HTTP ${status}` };
  }

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { ok: false, detail: `HTTP ${status}, response is not JSON` };
  }

  return Array.isArray(value)
    ? { ok: true, rows: value }
    : {
        ok: false,
        detail: `HTTP ${status}, response is not an array (type=${describeValue(value)})`,
      };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchResource(url: string, anonKey: string): Promise<ResourceResult> {
  let lastFailure: ResourceResult = {
    ok: false,
    detail: "request was not attempted",
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      // Node 22 native fetch (Undici) の接続タイムアウト既定値は10秒。
      // AbortSignal でレスポンス本文の読み取りを含む試行全体を30秒に制限する。
      const response = await fetch(url, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const decoded = decodeResponse(response.status, await response.text());
      if (decoded.ok) return decoded;
      lastFailure = {
        ok: false,
        detail: `attempt=${attempt}/${MAX_ATTEMPTS} ${decoded.detail}`,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      lastFailure = {
        ok: false,
        detail: `attempt=${attempt}/${MAX_ATTEMPTS} network_error=${detail}`,
      };
    }

    if (attempt < MAX_ATTEMPTS) await delay(RETRY_WAIT_MS);
  }

  return lastFailure;
}

function cronLogUrl(job: JobName): string {
  return `${BASE_URL}/rest/v1/cron_log?job_name=eq.${job}&select=job_name,created_at,status,result&order=created_at.desc&limit=${ROW_LIMIT}`;
}

function writeLines(lines: readonly string[]): void {
  process.stdout.write(`${lines.join("\n")}\n`);
}

function errorLine(diagnostic: Diagnostic): string {
  return `::error::区分 ${diagnostic.category} | job=${diagnostic.job} | ${diagnostic.message}`;
}

function writeResult(result: JudgeResult): void {
  writeLines(
    result.ok
      ? [...result.summaries, result.lcPerformanceSummary]
      : [
          ...result.diagnostics.map(errorLine),
          result.lcPerformanceSummary,
        ],
  );
}

export async function main(): Promise<void> {
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) {
    writeLines([
      "::error::区分 D | job=watchdog | SUPABASE_ANON_KEY secret が未設定です（リポジトリ Secrets に登録してください）",
    ]);
    process.exitCode = 1;
    return;
  }

  const [jobResources, lcPerformances] = await Promise.all([
    Promise.all(
      JOBS.map(async (job) => [job, await fetchResource(cronLogUrl(job), anonKey)] as const),
    ),
    fetchResource(
      `${BASE_URL}/rest/v1/lc_performances?select=event_date&order=event_date.desc&limit=1`,
      anonKey,
    ),
  ]);
  const cronLogs = Object.fromEntries(jobResources) as Record<
    JobName,
    ResourceResult
  >;
  const result = judge({ cronLogs, lcPerformances }, Date.now());
  writeResult(result);
  process.exitCode = result.ok ? 0 : 1;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  void main();
}
