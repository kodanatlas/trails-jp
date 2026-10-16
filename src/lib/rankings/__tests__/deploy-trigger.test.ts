import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// cron_log 読み出しのモック: from().select().eq().gte().abortSignal() → { data, error }
const historyResult = vi.hoisted(() => ({ value: { data: [] as unknown[] | null, error: null as unknown } }));
vi.mock("@/lib/supabase-admin", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    abortSignal: () => Promise.resolve(historyResult.value),
  };
  return { supabaseAdmin: { from: () => chain } };
});

import { runRankingDeploy } from "../deploy-trigger";

const HOOK = "https://api.vercel.com/v1/integrations/deploy/test-hook";
const ORIGIN = "https://trailsjp.vercel.app";
const A = "2026-10-04 京京立Day2";
const B = "2026-10-12 トータス50周年Day3";
// 2026-10-16(金) 19:07 JST
const FRIDAY = new Date("2026-10-16T10:07:00Z");

const joyPage = (headers: string[]) =>
  `<table><thead><tr><th>順位</th><th>氏名</th><th>所属</th><th>合計点数</th>${headers
    .map((h) => `<th>${h}</th>`)
    .join("")}</tr></thead><tbody></tbody></table>`;

const manifestOf = (headers: string[]) => ({
  generatedAt: "2026-10-16T03:44:00.000Z",
  categories: Object.fromEntries(
    ["elite_forest_M21E.json", "elite_sprint_S_Open.json", "age_forest_無差別.json", "age_sprint_S_無差別.json"].map(
      (f) => [f, { status: "fetched", headers }],
    ),
  ),
});

type FetchPlan = { joyHeaders?: string[]; manifestHeaders?: string[]; hookStatus?: number; failAll?: boolean };

function stubFetch(plan: FetchPlan) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (plan.failAll) throw new Error("network down");
    if (url === HOOK) {
      const status = plan.hookStatus ?? 201;
      return new Response(JSON.stringify({ job: { id: "job-1" } }), { status });
    }
    if (url.endsWith("/data/ranking-headers.json")) {
      return new Response(JSON.stringify(manifestOf(plan.manifestHeaders ?? [A])), { status: 200 });
    }
    return new Response(joyPage(plan.joyHeaders ?? [A]), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const hookCalls = (calls: string[]) => calls.filter((c) => c === `POST ${HOOK}`).length;
const logRow = (hoursAgo: number, status: "accepted" | "failed") => ({
  created_at: new Date(FRIDAY.getTime() - hoursAgo * 3_600_000).toISOString(),
  result: { deploy: { reason: "joy_updated", hook: { status } } },
});

beforeEach(() => {
  vi.stubEnv("VERCEL_DEPLOY_HOOK", HOOK);
  historyResult.value = { data: [], error: null };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("runRankingDeploy", () => {
  it("Hook 未設定なら何もしない", async () => {
    vi.stubEnv("VERCEL_DEPLOY_HOOK", "");
    const calls = stubFetch({});
    expect(await runRankingDeploy(ORIGIN, FRIDAY)).toEqual({ reason: null, skipped: "hook_not_configured" });
    expect(calls).toEqual([]);
  });

  it("水曜 JST は検査せず weekly を1回だけ送る（火→水の境界は JST 0時）", async () => {
    const calls = stubFetch({});
    const wedMidnight = new Date("2026-10-20T15:00:00Z"); // 10/21(水) 00:00 JST
    const log = await runRankingDeploy(ORIGIN, wedMidnight);
    expect(log.reason).toBe("weekly");
    expect(log.hook).toEqual({ status: "accepted", job: "job-1" });
    expect(calls).toEqual([`POST ${HOOK}`]);

    const tueLate = new Date("2026-10-20T14:59:00Z"); // 10/20(火) 23:59 JST
    const calls2 = stubFetch({});
    expect((await runRankingDeploy(ORIGIN, tueLate)).reason).toBeNull();
    expect(hookCalls(calls2)).toBe(0);
  });

  it("水曜→木曜の境界: 木曜 0時 JST は weekly にしない", async () => {
    const calls = stubFetch({});
    const thuMidnight = new Date("2026-10-21T15:00:00Z"); // 10/22(木) 00:00 JST
    expect((await runRankingDeploy(ORIGIN, thuMidnight)).reason).toBeNull();
    expect(hookCalls(calls)).toBe(0);
  });

  it("大会列の追加を検知し、履歴が空なら joy_updated を送る", async () => {
    const calls = stubFetch({ joyHeaders: [A, B], manifestHeaders: [A] });
    const log = await runRankingDeploy(ORIGIN, FRIDAY);
    expect(log.reason).toBe("joy_updated");
    expect(log.hook?.status).toBe("accepted");
    expect(hookCalls(calls)).toBe(1);
  });

  it("差分が無ければ送らない", async () => {
    const calls = stubFetch({ joyHeaders: [A], manifestHeaders: [A] });
    expect((await runRankingDeploy(ORIGIN, FRIDAY)).reason).toBeNull();
    expect(hookCalls(calls)).toBe(0);
  });

  it("履歴の DB 読み出しが失敗したら送らない", async () => {
    historyResult.value = { data: null, error: { message: "timeout" } };
    const calls = stubFetch({ joyHeaders: [A, B] });
    const log = await runRankingDeploy(ORIGIN, FRIDAY);
    expect(log).toMatchObject({ reason: null, skipped: "history_unavailable" });
    expect(hookCalls(calls)).toBe(0);
  });

  it("failed の Hook も試行として数える（20時間以内 → min_interval）", async () => {
    historyResult.value = { data: [logRow(10, "failed")], error: null };
    const calls = stubFetch({ joyHeaders: [A, B] });
    expect(await runRankingDeploy(ORIGIN, FRIDAY)).toMatchObject({ reason: null, skipped: "min_interval" });
    expect(hookCalls(calls)).toBe(0);
  });

  it("7日で accepted/failed 合わせて2回なら window_cap", async () => {
    historyResult.value = { data: [logRow(30, "accepted"), logRow(80, "failed")], error: null };
    const calls = stubFetch({ joyHeaders: [A, B] });
    expect(await runRankingDeploy(ORIGIN, FRIDAY)).toMatchObject({ reason: null, skipped: "window_cap" });
    expect(hookCalls(calls)).toBe(0);
  });

  it("weekly や旧形式のログは自動発火の回数に入れない", async () => {
    historyResult.value = {
      data: [
        { created_at: logRow(30, "accepted").created_at, result: { deploy: { reason: "weekly", hook: { status: "accepted" } } } },
        { created_at: logRow(10, "accepted").created_at, result: { deploy: { triggered: true, job: "old" } } },
      ],
      error: null,
    };
    const calls = stubFetch({ joyHeaders: [A, B] });
    expect((await runRankingDeploy(ORIGIN, FRIDAY)).reason).toBe("joy_updated");
    expect(hookCalls(calls)).toBe(1);
  });

  it("Hook が HTTP エラーなら failed として記録する", async () => {
    stubFetch({ joyHeaders: [A, B], hookStatus: 500 });
    expect((await runRankingDeploy(ORIGIN, FRIDAY)).hook).toEqual({ status: "failed", error: "HTTP 500" });
  });

  it("JOY も manifest も取得失敗なら例外を投げず、unknown で送らない", async () => {
    const calls = stubFetch({ failAll: true });
    const log = await runRankingDeploy(ORIGIN, FRIDAY);
    expect(log.reason).toBeNull();
    expect(log.checks?.every((c) => c.status === "unknown")).toBe(true);
    expect(hookCalls(calls)).toBe(0);
  });
});
