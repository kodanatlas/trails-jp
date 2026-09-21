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

const makeRequest = (healthy?: string) =>
  new Request(
    `https://example.com/api/cron/watchdog-ping?run_id=123&repo=owner%2Frepo${
      healthy === undefined ? "" : `&healthy=${healthy}`
    }`,
    { headers: { authorization: "Bearer test-secret" } },
  );

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
});

describe("GET", () => {
  it("heartbeat の記録に成功したとき 200 を返す", async () => {
    mocks.insert.mockResolvedValue({ error: null });

    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("判定が異常でも heartbeat を記録し、healthy=false を残す", async () => {
    mocks.insert.mockResolvedValue({ error: null });

    const response = await GET(makeRequest("false"));

    expect(response.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        job_name: "gh-watchdog",
        status: "success",
        result: expect.objectContaining({ healthy: "false" }),
      }),
    );
  });

  it("healthy が付かない ping でも記録する", async () => {
    mocks.insert.mockResolvedValue({ error: null });

    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ healthy: null }),
      }),
    );
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
