import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  AUTO_LIMITS,
  checkRankingStaleness,
  decideDeploy,
  sendDeployHook,
  type CategoryCheck,
  type DeployDecision,
  type HookResult,
} from "./staleness";

// sync-events cron から呼ぶ再デプロイ判定＋送信。結果は cron_log の result.deploy に残る。
// 設計: docs/plans/2026-10-16_joy_ranking_auto_rebuild.md

export interface RankingDeployLog {
  reason: "weekly" | "joy_updated" | null;
  skipped?: string;
  hook?: HookResult;
  checks?: CategoryCheck[];
  error?: string;
}

const HISTORY_TIMEOUT_MS = 5000;

/**
 * 過去 windowDays 日の joy_updated 送信時刻（ISO）。送信が失敗/タイムアウトでも
 * 受理済みの可能性があるため試行として数える。読めなければ null。
 */
async function loadAutoTriggerHistory(): Promise<string[] | null> {
  try {
    const since = new Date(Date.now() - AUTO_LIMITS.windowDays * 86_400_000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("cron_log")
      .select("created_at, result")
      .eq("job_name", "sync-events")
      .gte("created_at", since)
      .abortSignal(AbortSignal.timeout(HISTORY_TIMEOUT_MS));
    if (error || !data) return null;
    return (data as { created_at: string; result: { deploy?: RankingDeployLog } | null }[])
      .filter((row) => row.result?.deploy?.reason === "joy_updated" && row.result.deploy.hook)
      .map((row) => row.created_at);
  } catch {
    return null;
  }
}

function isWednesdayJst(now: Date): boolean {
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" })).getDay() === 3;
}

export async function runRankingDeploy(origin: string, now: Date = new Date()): Promise<RankingDeployLog> {
  const hookUrl = process.env.VERCEL_DEPLOY_HOOK;
  if (!hookUrl) return { reason: null, skipped: "hook_not_configured" };

  try {
    if (isWednesdayJst(now)) {
      return { reason: "weekly", hook: await sendDeployHook(hookUrl) };
    }

    const checks = await checkRankingStaleness(origin);
    const stale = checks.some((c) => c.status === "stale");
    const history = stale ? await loadAutoTriggerHistory() : [];
    const decision: DeployDecision = decideDeploy({ isWednesday: false, checks, history, now: now.getTime() });

    if (decision.action === "joy_updated") {
      return { reason: "joy_updated", hook: await sendDeployHook(hookUrl), checks };
    }
    return {
      reason: null,
      ...(decision.action === "none" && decision.skipped ? { skipped: decision.skipped } : {}),
      checks,
    };
  } catch (e) {
    console.error("ranking deploy check failed:", e);
    return { reason: null, error: String(e) };
  }
}
