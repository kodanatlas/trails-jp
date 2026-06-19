import { describe, it, expect } from "vitest";
import { entryIndexAgeHours, isEntryIndexStale } from "../freshness";

const THRESHOLD = 26;
// 基準時刻（固定・決定的）。
const NOW = Date.parse("2026-06-17T03:00:00Z");
const hAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe("entryIndexAgeHours", () => {
  it("経過時間を時間単位で返す（10h前 → 10）", () => {
    expect(entryIndexAgeHours(hAgo(10), NOW)).toBeCloseTo(10, 6);
  });

  it("端数も正しく算出する（1.5h前 → 1.5）", () => {
    expect(entryIndexAgeHours(hAgo(1.5), NOW)).toBeCloseTo(1.5, 6);
  });

  it("null / undefined は null", () => {
    expect(entryIndexAgeHours(null, NOW)).toBeNull();
    expect(entryIndexAgeHours(undefined, NOW)).toBeNull();
  });

  it("パース不能文字列は null", () => {
    expect(entryIndexAgeHours("not-a-date", NOW)).toBeNull();
    expect(entryIndexAgeHours("", NOW)).toBeNull();
  });

  it("未来時刻は負の経過時間（クランプしない）", () => {
    expect(entryIndexAgeHours(hAgo(-2), NOW)).toBeCloseTo(-2, 6);
  });
});

describe("isEntryIndexStale", () => {
  it("閾値より新しい（<26h）→ 古くない", () => {
    expect(isEntryIndexStale(hAgo(25), NOW, THRESHOLD)).toBe(false);
    expect(isEntryIndexStale(hAgo(1), NOW, THRESHOLD)).toBe(false);
  });

  it("ちょうど閾値（=26h）→ 古くない（境界は > 判定）", () => {
    expect(isEntryIndexStale(hAgo(26), NOW, THRESHOLD)).toBe(false);
  });

  it("閾値超（>26h）→ 古い", () => {
    expect(isEntryIndexStale(hAgo(26.0001), NOW, THRESHOLD)).toBe(true);
    expect(isEntryIndexStale(hAgo(48), NOW, THRESHOLD)).toBe(true);
  });

  it("null / undefined / 不正文字列 → 古い（鮮度不明は警告側へ倒す）", () => {
    expect(isEntryIndexStale(null, NOW, THRESHOLD)).toBe(true);
    expect(isEntryIndexStale(undefined, NOW, THRESHOLD)).toBe(true);
    expect(isEntryIndexStale("garbage", NOW, THRESHOLD)).toBe(true);
  });
});
