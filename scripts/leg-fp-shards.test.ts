import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeLegFpShards } from "./leg-fp-shards";
import {
  FingerprintInvariantError,
  fingerprintGen,
  isSafeShardKey,
  legFpShardUrl,
} from "../src/lib/analysis/leg-fingerprint-details";
import type { DisciplineDetail } from "../src/lib/analysis/leg-fingerprint-details";

const detail: DisciplineDetail = {
  races: [{ d: "2026-09-20", e: "大会", c: "ME", ev: 1, cl: 2, ri: 3, L: 5 }],
  legs: { r: [0], l: [1], c: [0], lap: [120], loss: [40], m: [1], fm: [12], fn: [9] },
  pack: { r: [], l: [] },
};

describe("世代番号・ファイル名・URL", () => {
  it("generatedAt からミリ秒まで含む世代番号を作る", () => {
    expect(fingerprintGen("2026-09-30T10:48:02.219Z")).toBe("20260930T104802219Z");
  });
  it("パス区切りや隠しファイルになる名前は弾く", () => {
    expect(isSafeShardKey("宮本樹")).toBe(true);
    expect(isSafeShardKey("a/b")).toBe(false);
    expect(isSafeShardKey("a\\b")).toBe(false);
    expect(isSafeShardKey("..")).toBe(false);
    expect(isSafeShardKey(".hidden")).toBe(false);
    expect(isSafeShardKey("")).toBe(false);
  });
  it("URL は選手キーをエンコードする", () => {
    expect(legFpShardUrl("20260930T104802Z", "宮本樹")).toBe(
      `/data/leg-fp/20260930T104802Z/${encodeURIComponent("宮本樹")}.json`
    );
  });
});

describe("writeLegFpShards", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "legfp-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("選手ごとに gen 付きファイルを書き、古い世代を消し、容量を集計する", () => {
    fs.mkdirSync(path.join(dir, "leg-fp", "OLDGEN"), { recursive: true });
    fs.writeFileSync(path.join(dir, "leg-fp", "OLDGEN", "x.json"), "{}");
    const stats = writeLegFpShards(dir, "NEWGEN", { 宮本樹: { f: detail }, 児玉健: { f: detail } });
    expect(fs.existsSync(path.join(dir, "leg-fp", "OLDGEN"))).toBe(false);
    const written = JSON.parse(fs.readFileSync(path.join(dir, "leg-fp", "NEWGEN", "宮本樹.json"), "utf-8"));
    expect(written).toEqual({ gen: "NEWGEN", f: detail });
    expect(stats.files).toBe(2);
    expect(stats.totalBytes).toBeGreaterThan(0);
  });

  it("ファイル名にできない選手キーがあれば、何も書かずに FingerprintInvariantError", () => {
    expect(() => writeLegFpShards(dir, "NEWGEN", { 宮本樹: { f: detail }, "a/b": { f: detail } })).toThrow(
      FingerprintInvariantError
    );
    expect(fs.existsSync(path.join(dir, "leg-fp", "NEWGEN", "宮本樹.json"))).toBe(false);
  });
});
