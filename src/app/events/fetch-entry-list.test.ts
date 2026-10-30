import { describe, it, expect, vi } from "vitest";
import { fetchEntryList } from "./fetch-entry-list";

const okBody = { eventId: 2437, total: 1, teams: [], fetchedAt: "2026-10-30T00:00:00Z" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const html504 = () => new Response("<html>Gateway Timeout</html>", { status: 504 });

describe("fetchEntryList", () => {
  it("1回目で成功すれば再試行しない", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(okBody));
    await expect(fetchEntryList(2437, { fetcher, retryDelayMs: 0 })).resolves.toEqual(okBody);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/events/2437/entries");
  });

  it("504（非JSON）の後に成功すれば結果を返す", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(html504()).mockResolvedValueOnce(json(okBody));
    await expect(fetchEntryList(2437, { fetcher, retryDelayMs: 0 })).resolves.toEqual(okBody);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("回線断（fetch reject）の後に成功すれば結果を返す", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("Load failed")).mockResolvedValueOnce(json(okBody));
    await expect(fetchEntryList(2437, { fetcher, retryDelayMs: 0 })).resolves.toEqual(okBody);
  });

  it("API の error 付き応答は失敗として扱い、取り直す", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ ...okBody, total: 0, error: "fetch_failed" }))
      .mockResolvedValueOnce(json(okBody));
    await expect(fetchEntryList(2437, { fetcher, retryDelayMs: 0 })).resolves.toEqual(okBody);
  });

  it("2回とも失敗したら throw する", async () => {
    const fetcher = vi.fn().mockImplementation(async () => html504());
    await expect(fetchEntryList(2437, { fetcher, retryDelayMs: 0 })).rejects.toThrow("504");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
