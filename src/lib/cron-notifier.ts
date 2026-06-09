import { supabaseAdmin } from "./supabase-admin";

/**
 * Cron 通知の Resend メール送信。
 * - error: ジョブが失敗で終了したとき（logCron 経由）。
 * - warning: ジョブは成功扱いだが異常の兆候があるとき（空date急増・取りこぼし等）。
 * 同一 (job_name, level:signature) の通知は 24h で 1 通までデダブする。
 *
 * 失敗時は console.error のみ。呼び出し元に例外を投げない。
 */

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

type Level = "error" | "warning";

/** result jsonb から重複判定用の文字列シグネチャを生成 */
function extractErrorSignature(result: unknown): string {
  if (!result) return "no-result";
  if (typeof result === "string") return result.slice(0, 200);
  if (typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.error === "string") return r.error.slice(0, 200);
    return JSON.stringify(r).slice(0, 200);
  }
  return String(result).slice(0, 200);
}

/**
 * 通知本体。level と signature を明示的に受け取り、デダブ＋送信する。
 * デダブキーは `${level}:${signature}` なので error と warning は独立にデダブされる。
 */
async function sendCronNotification(
  jobName: string,
  level: Level,
  signature: string,
  result: unknown,
  durationMs: number,
): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const toEmail = process.env.NOTIFICATION_TO_EMAIL;
    if (!apiKey || !toEmail) {
      console.warn(`notifyCron(${level}): RESEND_API_KEY or NOTIFICATION_TO_EMAIL missing, skip`);
      return;
    }
    const fromEmail = process.env.NOTIFICATION_FROM_EMAIL ?? "onboarding@resend.dev";

    const dedupSignature = `${level}:${signature}`.slice(0, 200);

    // ---- 24h デダブチェック ----
    const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    const { data: dedup, error: dedupErr } = await supabaseAdmin
      .from("cron_notification_log")
      .select("id")
      .eq("job_name", jobName)
      .eq("error_signature", dedupSignature)
      .gte("sent_at", since)
      .limit(1);

    if (dedupErr) {
      console.error("notifyCron dedup query failed:", dedupErr.message);
      // dedup失敗時は fail-open（送る）
    } else if (dedup && dedup.length > 0) {
      // 24h以内に同じシグネチャの通知済み → スキップ
      return;
    }

    // ---- Resend 送信 ----
    const label = level === "error" ? "error" : "warning";
    const subject = `[trails.jp] Cron ${label}: ${jobName}`;
    const body =
      `Cron job が ${label} を報告しました。\n\n` +
      `job: ${jobName}\n` +
      `level: ${label}\n` +
      `duration: ${durationMs} ms\n` +
      `time: ${new Date().toISOString()}\n\n` +
      `detail:\n${JSON.stringify(result, null, 2)}\n\n` +
      `status: https://trailsjp.vercel.app/admin/cron-status\n`;

    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: toEmail,
        subject,
        text: body,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`notifyCron Resend ${res.status}: ${errText.slice(0, 200)}`);
      return;
    }

    // ---- デダブ記録 ----
    const { error: insertErr } = await supabaseAdmin
      .from("cron_notification_log")
      .insert({ job_name: jobName, error_signature: dedupSignature });
    if (insertErr) {
      console.error("notifyCron dedup insert failed:", insertErr.message);
    }
  } catch (e) {
    console.error("notifyCron unexpected:", e);
  }
}

/** ジョブ失敗（error）通知。シグネチャは result から自動抽出。 */
export async function notifyCronError(
  jobName: string,
  result: unknown,
  durationMs: number,
): Promise<void> {
  await sendCronNotification(jobName, "error", extractErrorSignature(result), result, durationMs);
}

/**
 * 異常兆候（warning）通知。ジョブ自体は success でも、空date急増・取りこぼし等を検知したら呼ぶ。
 * signature は警告の種類を表す安定文字列（例: "high_empty_dates"）。件数等の変動値は含めない方がデダブが効く。
 */
export async function notifyCronWarning(
  jobName: string,
  signature: string,
  result: unknown,
  durationMs: number,
): Promise<void> {
  await sendCronNotification(jobName, "warning", signature, result, durationMs);
}
