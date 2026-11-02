import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../retry";

describe("withRetry", () => {
  it("成功すれば1回で返す", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn, { delayMs: 0 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("1回目の fetch failed の後に成功すれば結果を返す", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce("ok");
    await expect(withRetry(fn, { delayMs: 0 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("全試行が失敗したら最後のエラーを throw する", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("first"))
      .mockRejectedValueOnce(new TypeError("second"));
    await expect(withRetry(fn, { delayMs: 0 })).rejects.toThrow("second");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
