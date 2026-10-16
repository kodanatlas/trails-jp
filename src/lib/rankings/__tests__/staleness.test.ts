import { describe, it, expect } from "vitest";
import { compareCategory, decideDeploy, parseManifest, type HeaderManifest } from "../staleness";

const FILE = "elite_forest_M21E.json";
const A = "2026-10-04 京京立Day2";
const B = "2026-10-12 トータス50周年Day3";
const manifest: HeaderManifest = {
  generatedAt: "2026-10-16T03:44:00.000Z",
  categories: { [FILE]: { status: "fetched", headers: [A] } },
};

const NOW = Date.parse("2026-10-16T10:07:00Z");
const hAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const stale = [{ file: FILE, status: "stale" as const, missing: [B] }];

describe("compareCategory", () => {
  it("JOY にあって manifest に無い大会列を stale として返す", () => {
    expect(compareCategory(FILE, { headers: [A, B] }, manifest)).toEqual({ file: FILE, status: "stale", missing: [B] });
  });

  it("manifest 側にしか無い列（JOY の集計窓から外れた古い大会）は stale にしない", () => {
    expect(compareCategory(FILE, { headers: [A] }, {
      ...manifest,
      categories: { [FILE]: { status: "fetched", headers: [A, "2025-10-18 KOLC大会"] } },
    })).toEqual({ file: FILE, status: "ok" });
  });

  it("取得失敗・大会列0件・manifest 欠落・kept はすべて unknown（発火させない）", () => {
    expect(compareCategory(FILE, { error: "timeout" }, manifest).status).toBe("unknown");
    expect(compareCategory(FILE, { headers: [] }, manifest).status).toBe("unknown");
    expect(compareCategory(FILE, { headers: [A, B] }, null).status).toBe("unknown");
    expect(compareCategory("other.json", { headers: [A, B] }, manifest).status).toBe("unknown");
    expect(
      compareCategory(FILE, { headers: [A, B] }, { ...manifest, categories: { [FILE]: { status: "kept", headers: [] } } }).status,
    ).toBe("unknown");
  });

  it("manifest 側の大会列が0件なら unknown（全列 missing に見えて誤発火しない）", () => {
    expect(
      compareCategory(FILE, { headers: [A, B] }, { ...manifest, categories: { [FILE]: { status: "fetched", headers: [] } } }),
    ).toEqual({ file: FILE, status: "unknown", error: "no event headers in manifest" });
  });
});

describe("decideDeploy", () => {
  it("水曜は検知結果によらず weekly", () => {
    expect(decideDeploy({ isWednesday: true, checks: [], history: null, now: NOW })).toEqual({ action: "weekly" });
  });

  it("stale が無ければ何もしない", () => {
    expect(decideDeploy({ isWednesday: false, checks: [{ file: FILE, status: "ok" }], history: [], now: NOW })).toEqual({
      action: "none",
    });
  });

  it("stale かつ履歴が空なら joy_updated", () => {
    expect(decideDeploy({ isWednesday: false, checks: stale, history: [], now: NOW })).toEqual({ action: "joy_updated" });
  });

  it("履歴を読めなければ発火しない（DB 障害でビルドを増やさない）", () => {
    expect(decideDeploy({ isWednesday: false, checks: stale, history: null, now: NOW })).toEqual({
      action: "none",
      skipped: "history_unavailable",
    });
  });

  it("直近20時間以内に発火済みなら抑止", () => {
    expect(decideDeploy({ isWednesday: false, checks: stale, history: [hAgo(19)], now: NOW })).toEqual({
      action: "none",
      skipped: "min_interval",
    });
  });

  it("直近7日で2回発火済みなら抑止、7日より前は数えない", () => {
    expect(decideDeploy({ isWednesday: false, checks: stale, history: [hAgo(30), hAgo(100)], now: NOW })).toEqual({
      action: "none",
      skipped: "window_cap",
    });
    expect(decideDeploy({ isWednesday: false, checks: stale, history: [hAgo(30), hAgo(24 * 8)], now: NOW })).toEqual({
      action: "joy_updated",
    });
  });
});

describe("parseManifest", () => {
  it("正しい形だけ受け付ける", () => {
    expect(parseManifest(manifest)).toEqual(manifest);
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest({ generatedAt: "x", categories: { [FILE]: { status: "bad", headers: [] } } })).toBeNull();
    expect(parseManifest({ generatedAt: "x", categories: { [FILE]: { status: "fetched", headers: [1] } } })).toBeNull();
  });
});
