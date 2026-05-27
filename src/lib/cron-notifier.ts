import { supabaseAdmin } from "./supabase-admin";

/**
 * Cron エラー時の Resend メール通知。
 * 同一 (job_name, error_signature) の通知は 24h で 1 通までデダブする。
 *
 * 失敗時は console.error のみ。呼び出し元（logCron）に例外を投げない。
 */

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

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

export async function notifyCronError(
  jobName: string,
  result: unknown,
  durationMs: number,
): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const toEmail = process.env.NOTIFICATION_TO_EMAIL;
    if (!apiKey || !toEmail) {
      console.warn("notifyCronError: RESEND_API_KEY or NOTIFICATION_TO_EMAIL missing, skip");
      return;
    }
    const fromEmail = process.env.NOTIFICATION_FROM_EMAIL ?? "onboarding@resend.dev";

    const signature = extractErrorSignature(result);

    // ---- 24h デダブチェック ----
    const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    const { data: dedup, error: dedupErr } = await supabaseAdmin
      .from("cron_notification_log")
      .select("id")
      .eq("job_name", jobName)
      .eq("error_signature", signature)
      .gte("sent_at", since)
      .limit(1);

    if (dedupErr) {
      console.error("notifyCronError dedup query failed:", dedupErr.message);
      // dedup失敗時は fail-open（送る）
    } else if (dedup && dedup.length > 0) {
      // 24h以内に同じシグネチャのエラー通知済み → スキップ
      return;
    }

    // ---- Resend 送信 ----
    const subject = `[trails.jp] Cron error: ${jobName}`;
    const body =
      `Cron job が error で終了しました。\n\n` +
      `job: ${jobName}\n` +
      `duration: ${durationMs} ms\n` +
      `time: ${new Date().toISOString()}\n\n` +
      `result:\n${JSON.stringify(result, null, 2)}\n\n` +
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
      console.error(`notifyCronError Resend ${res.status}: ${errText.slice(0, 200)}`);
      return;
    }

    // ---- デダブ記録 ----
    const { error: insertErr } = await supabaseAdmin
      .from("cron_notification_log")
      .insert({ job_name: jobName, error_signature: signature });
    if (insertErr) {
      console.error("notifyCronError dedup insert failed:", insertErr.message);
    }
  } catch (e) {
    console.error("notifyCronError unexpected:", e);
  }
}
