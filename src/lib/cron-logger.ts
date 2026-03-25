import { supabaseAdmin } from "./supabase-admin";

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
}
