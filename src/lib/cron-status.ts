/**
 * Cron 稼働状況の健康判定ロジック（純粋関数）。
 * /admin/cron-status ページで使用。
 */

export type CronJobName = "sync-events" | "sync-lapcenter" | "sync-entries";
export type Health = "green" | "yellow" | "red";

export interface CronLogRow {
  id: number;
  job_name: string;
  status: "success" | "error" | string;
  result: unknown;
  duration_ms: number | null;
  created_at: string; // ISO timestamptz
}

export interface JobAssessment {
  job: CronJobName;
  overall: Health;
  reasons: string[];
  latest: CronLogRow | null;
  lastSuccess: CronLogRow | null;
  ageMs: number | null;
}

/** ジョブごとの実行時刻（JST 24h）。健康判定の水曜カットオフに使用。 */
export const JOB_CONFIG: Record<CronJobName, { runHourJst: number; label: string }> = {
  "sync-events": { runHourJst: 3, label: "イベント同期" },
  "sync-lapcenter": { runHourJst: 12, label: "LapCenter同期" },
  "sync-entries": { runHourJst: 4, label: "エントリー同期" },
};

const HOUR_MS = 3_600_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 「直近の水曜 runHour:00 JST」を返す。
 * 今日が水曜だが指定時刻より前なら、先週水曜を返す。
 * 戻り値はUTC基準のDate（比較は Date.getTime() で行う想定）。
 */
export function lastWednesdayCutoffJst(now: Date, runHourJst: number): Date {
  const nowJstMs = now.getTime() + JST_OFFSET_MS;
  const nowJst = new Date(nowJstMs);
  const dow = nowJst.getUTCDay(); // 0=Sun, 3=Wed
  const diffToWed = (dow - 3 + 7) % 7;

  // 今週(または今日)の水曜の runHour:00 JST
  const candidateJst = new Date(nowJstMs);
  candidateJst.setUTCDate(candidateJst.getUTCDate() - diffToWed);
  candidateJst.setUTCHours(runHourJst, 0, 0, 0);

  // 候補が未来（=今日水曜だが実行時刻前）なら先週水曜にずらす
  if (candidateJst.getTime() > nowJstMs) {
    candidateJst.setUTCDate(candidateJst.getUTCDate() - 7);
  }

  // JST想定で組んだ時刻をUTCに戻す
  return new Date(candidateJst.getTime() - JST_OFFSET_MS);
}

/**
 * Cron ジョブの健康状態を判定する。
 *
 * 判定ルール:
 *  - 緑: 直近24h以内に success がある & 水曜サブチェックも問題なし
 *  - 黄: 直近実行が24-48h前 / 直近水曜以降の成功実行なし / deploy.triggered=false
 *  - 赤: 直近実行が48h超 / 直近実行が error / 水曜なのに deploy/runners が null・error
 */
export function assessJobHealth(
  job: CronJobName,
  rows: CronLogRow[],
  now: Date = new Date(),
): JobAssessment {
  const reasons: string[] = [];

  if (rows.length === 0) {
    return {
      job,
      overall: "red",
      reasons: ["実行履歴なし"],
      latest: null,
      lastSuccess: null,
      ageMs: null,
    };
  }

  const latest = rows[0];
  const lastSuccess = rows.find((r) => r.status === "success") ?? null;
  const ageMs = now.getTime() - new Date(latest.created_at).getTime();

  // ---- 基本判定 ----
  let base: Health = "green";
  if (latest.status === "error") {
    base = "red";
    reasons.push("直近実行が error");
  } else if (ageMs > 48 * HOUR_MS) {
    base = "red";
    reasons.push("48時間以上 未実行");
  } else if (ageMs > 24 * HOUR_MS) {
    base = "yellow";
    reasons.push("24-48時間 未実行");
  }

  // ---- 水曜サブチェック ----
  // 「直近水曜の実行時刻」から24h ウィンドウ内の success を探す
  // (Cron は1日1回なのでウィンドウ内には最大1件のはず)
  let weekly: Health = "green";
  const cutoff = lastWednesdayCutoffJst(now, JOB_CONFIG[job].runHourJst);
  const cutoffMs = cutoff.getTime();
  const windowEndMs = cutoffMs + 24 * HOUR_MS;
  const sinceWedSuccess = rows.find((r) => {
    const t = new Date(r.created_at).getTime();
    return t >= cutoffMs && t < windowEndMs && r.status === "success";
  });

  if (!sinceWedSuccess) {
    weekly = "yellow";
    reasons.push("直近水曜の成功実行なし");
  } else {
    const result = sinceWedSuccess.result as Record<string, unknown> | null;
    if (job === "sync-events") {
      const deploy = result?.deploy as { triggered?: boolean } | null | undefined;
      if (deploy === null || deploy === undefined) {
        weekly = "red";
        reasons.push("水曜なのに deploy が null（再デプロイ未実行）");
      } else if (deploy.triggered === false) {
        weekly = "yellow";
        reasons.push("deploy.triggered=false");
      }
    } else if (job === "sync-lapcenter") {
      const runners = result?.runners as { error?: string } | null | undefined;
      if (runners === null || runners === undefined) {
        weekly = "red";
        reasons.push("水曜なのに runners が null（巡航速度スクレイプ未実行）");
      } else if (runners.error) {
        weekly = "red";
        reasons.push(`runners.error: ${runners.error}`);
      }
    }
  }

  const order: Health[] = ["green", "yellow", "red"];
  const overall = [base, weekly].sort(
    (a, b) => order.indexOf(b) - order.indexOf(a),
  )[0];

  return { job, overall, reasons, latest, lastSuccess, ageMs };
}

/** Health に対応する Tailwind カラー（バッジ・カード枠用） */
export function healthColors(h: Health): {
  bg: string;
  border: string;
  text: string;
  label: string;
} {
  switch (h) {
    case "green":
      return {
        bg: "bg-green-500/10",
        border: "border-green-500/40",
        text: "text-green-400",
        label: "正常",
      };
    case "yellow":
      return {
        bg: "bg-yellow-500/10",
        border: "border-yellow-500/40",
        text: "text-yellow-400",
        label: "警告",
      };
    case "red":
      return {
        bg: "bg-red-500/10",
        border: "border-red-500/40",
        text: "text-red-400",
        label: "異常",
      };
  }
}

/** ms を「N時間M分前」形式に整形 */
export function formatAge(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 60_000) return "1分未満前";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間${minutes % 60}分前`;
  const days = Math.floor(hours / 24);
  return `${days}日${hours % 24}時間前`;
}

/** ISO timestamptz を JST 表示文字列に整形 */
export function formatJst(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}
