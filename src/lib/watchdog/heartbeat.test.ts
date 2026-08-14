import { describe, expect, it } from "vitest";
import { isWatchdogSilent, watchdogPingAgeHours } from "./heartbeat";

const THRESHOLD = 36;
// 基準時刻（固定・決定的）。
const NOW = Date.parse("2026-08-14T12:41:00Z");
const msAgo = (ms: number) => new Date(NOW - ms).toISOString();
const hAgo = (hours: number) => msAgo(hours * 3_600_000);

describe("watchdogPingAgeHours", () => {
  it("経過時間を時間単位で返す（20.4h前 → 20.4）", () => {
    expect(watchdogPingAgeHours(hAgo(20.4), NOW)).toBeCloseTo(20.4, 6);
  });

  it("null / undefined / 空文字 / 不正文字列は null", () => {
    expect(watchdogPingAgeHours(null, NOW)).toBeNull();
    expect(watchdogPingAgeHours(undefined, NOW)).toBeNull();
    expect(watchdogPingAgeHours("", NOW)).toBeNull();
    expect(watchdogPingAgeHours("not-a-date", NOW)).toBeNull();
  });
});

describe("isWatchdogSilent", () => {
  it("正常時の約20.4時間前の ping → 沈黙していない", () => {
    expect(isWatchdogSilent(hAgo(20.4), NOW, THRESHOLD)).toBe(false);
  });

  it("watchdog が1日飛んだ約44.4時間前の ping → 沈黙", () => {
    expect(isWatchdogSilent(hAgo(44.4), NOW, THRESHOLD)).toBe(true);
  });

  it("36時間ちょうどの ping → 沈黙していない", () => {
    expect(isWatchdogSilent(hAgo(36), NOW, THRESHOLD)).toBe(false);
  });

  it("36h 境界（35:59:59 → 非沈黙 / 36:00:01 → 沈黙）", () => {
    expect(isWatchdogSilent(msAgo(36 * 3_600_000 - 1_000), NOW, THRESHOLD)).toBe(false);
    expect(isWatchdogSilent(msAgo(36 * 3_600_000 + 1_000), NOW, THRESHOLD)).toBe(true);
  });

  it("null / 空文字 / 不正文字列 → 沈黙（鮮度不明は警告側へ倒す）", () => {
    expect(isWatchdogSilent(null, NOW, THRESHOLD)).toBe(true);
    expect(isWatchdogSilent("", NOW, THRESHOLD)).toBe(true);
    expect(isWatchdogSilent("garbage", NOW, THRESHOLD)).toBe(true);
  });
});
