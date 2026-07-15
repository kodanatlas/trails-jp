import { describe, it, expect } from "vitest";
import { nextSyncAt, SYNC_HOURS_UTC } from "../schedule";

describe("nextSyncAt", () => {
  it("同日の次の実行時刻を返す", () => {
    // 02:00 UTC (11:00 JST) → 次は 04:00 UTC (13:00 JST)
    expect(nextSyncAt(new Date("2026-07-20T02:00:00Z")).toISOString()).toBe("2026-07-20T04:00:00.000Z");
  });

  it("1本目を過ぎたら2本目を返す", () => {
    // 05:00 UTC (14:00 JST) → 次は 14:00 UTC (23:00 JST)
    expect(nextSyncAt(new Date("2026-07-20T05:00:00Z")).toISOString()).toBe("2026-07-20T14:00:00.000Z");
  });

  it("最後の実行を過ぎたら翌日の1本目を返す", () => {
    // 15:00 UTC (翌00:00 JST) → 次は翌 04:00 UTC (13:00 JST)
    expect(nextSyncAt(new Date("2026-07-20T15:00:00Z")).toISOString()).toBe("2026-07-21T04:00:00.000Z");
  });

  it("月跨ぎでも壊れない", () => {
    expect(nextSyncAt(new Date("2026-07-31T23:00:00Z")).toISOString()).toBe("2026-08-01T04:00:00.000Z");
  });

  it("ちょうどの時刻は「次」に含めない（過ぎたものを次回として出さない）", () => {
    expect(nextSyncAt(new Date("2026-07-20T04:00:00Z")).toISOString()).toBe("2026-07-20T14:00:00.000Z");
  });

  it("順不同で渡してもソートして扱う", () => {
    expect(nextSyncAt(new Date("2026-07-20T05:00:00Z"), [14, 4]).toISOString()).toBe(
      "2026-07-20T14:00:00.000Z",
    );
  });

  it("workflow の cron と一致していること（二重管理の検知）", () => {
    // .github/workflows/sync-oringen.yml: `- cron: "0 4,14 * * *"`
    expect(SYNC_HOURS_UTC).toEqual([4, 14]);
  });

  it("JST 表示が 13:00 / 23:00 になる", () => {
    const fmt = (d: Date) =>
      new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);
    expect(fmt(nextSyncAt(new Date("2026-07-20T02:00:00Z")))).toBe("13:00");
    expect(fmt(nextSyncAt(new Date("2026-07-20T05:00:00Z")))).toBe("23:00");
  });
});
