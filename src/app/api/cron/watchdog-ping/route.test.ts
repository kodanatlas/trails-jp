import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  notifyCronError: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: mocks.from,
  },
}));

vi.mock("@/lib/cron-notifier", () => ({
  notifyCronError: mocks.notifyCronError,
}));

import { logCron } from "@/lib/cron-logger";
import { GET } from "./route";

const makeRequest = () =>
  new Request("https://example.com/api/cron/watchdog-ping?run_id=123&repo=owner%2Frepo", {
    headers: { authorization: "Bearer test-secret" },
  });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  mocks.from.mockReset();
  mocks.insert.mockReset();
  mocks.notifyCronError.mockReset();
  mocks.from.mockReturnValue({ insert: mocks.insert });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("logCron", () => {
  it("insert が成功したとき true を返す", async () => {
    mocks.insert.mockResolvedValue({ error: null });

    await expect(logCron("test-job", "success", { ok: true }, 10)).resolves.toBe(true);
  });

  it("insert が error を返したとき false を返す", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.insert.mockResolvedValue({ error: { message: "insert failed" } });

    await expect(logCron("test-job", "success", { ok: false }, 10)).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalled();
  });

  it("insert が throw したとき false を返す", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.insert.mockRejectedValue(new Error("insert failed"));

    await expect(logCron("test-job", "success", { ok: false }, 10)).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalled();
  });

  // ---- timeoutMs 経路 ----
  // 開始記録(started)は本処理の実行予算を食わないよう短い期限で打ち切る。
  // postgrest-js の abortSignal() は signal を保持して自身を返す破壊的メソッドなので、
  // Promise を返すだけの mock では検証できない。実物に合わせた thenable を使う。
  function queryWithAbortSignal(settle: () => Promise<{ error: unknown }>) {
    const query = {
      abortSignal: vi.fn((_signal: AbortSignal) => query),
      then: (
        onFulfilled: (value: { error: unknown }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => settle().then(onFulfilled, onRejected),
    };
    return query;
  }

  it("timeoutMs を渡すと AbortSignal 付きで実行し、成功なら true を返す", async () => {
    const query = queryWithAbortSignal(async () => ({ error: null }));
    mocks.insert.mockReturnValue(query);

    await expect(
      logCron("test-job", "started", { ok: true }, 0, { timeoutMs: 2_000 }),
    ).resolves.toBe(true);
    expect(query.abortSignal).toHaveBeenCalledTimes(1);
    expect(query.abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });

  it("timeoutMs で打ち切られても throw せず false を返す", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const query = queryWithAbortSignal(async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    });
    mocks.insert.mockReturnValue(query);

    await expect(
      logCron("test-job", "started", { ok: false }, 0, { timeoutMs: 1 }),
    ).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalled();
  });

  it("timeoutMs を渡さないときは abortSignal を呼ばない", async () => {
    const query = queryWithAbortSignal(async () => ({ error: null }));
    mocks.insert.mockReturnValue(query);

    await expect(logCron("test-job", "success", { ok: true }, 10)).resolves.toBe(true);
    expect(query.abortSignal).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("heartbeat の記録に成功したとき 200 を返す", async () => {
    mocks.insert.mockResolvedValue({ error: null });

    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("heartbeat の記録に失敗したとき 500 を返す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.insert.mockResolvedValue({ error: { message: "insert failed" } });

    const response = await GET(makeRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Failed to record watchdog heartbeat",
    });
  });
});
