import { supabaseAdmin } from "./supabase-admin";
import { notifyCronError } from "./cron-notifier";

export async function logCron(
  jobName: string,
  status: "success" | "error",
  result: unknown,
  durationMs: number,
) {
  try {
    await supabaseAdmin.from("cron_log").insert({
      job_name: jobName,
      status,
      result,
      duration_ms: durationMs,
    });
  } catch {
    // ログ失敗でCron本体を巻き込まない
    console.error("cron_log insert failed");
  }

  // error 時はメール通知（内部で例外握りつぶし、呼び出し元に投げない）。
  // Cron 本体の Vercel Function 終了タイミングと競合しないよう await して完了を待つ。
  if (status === "error") {
    await notifyCronError(jobName, result, durationMs);
  }
}
