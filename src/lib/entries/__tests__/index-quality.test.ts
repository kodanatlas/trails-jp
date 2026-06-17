import { describe, it, expect } from "vitest";
import { isIndexRegression } from "../index-quality";
import type { EntryIndex } from "../index-types";

/** athletes を n 人持つだけのダミー index（劣化判定は Object.keys 数しか見ない）。 */
function idx(n: number): EntryIndex {
  const athletes: Record<string, never[]> = {};
  for (let i = 0; i < n; i++) athletes["k" + i] = [];
  return {
    generatedAt: "2026-06-17T00:00:00.000Z",
    targetEventCount: 0,
    scrapedEventCount: 0,
    athletes: athletes as EntryIndex["athletes"],
  };
}

const opts = { minRatio: 0.6, floor: 100 };

describe("isIndexRegression", () => {
  it("prev が null なら劣化ではない（初回生成は常に書く）", () => {
    expect(isIndexRegression(null, idx(500), opts)).toBe(false);
  });

  it("既存が floor 未満なら判定しない（閑散期・成長期）", () => {
    expect(isIndexRegression(idx(50), idx(5), opts)).toBe(false);
  });

  it("athletes が大幅減（<60%）なら劣化", () => {
    expect(isIndexRegression(idx(1000), idx(500), opts)).toBe(true);
  });

  it("境界: ちょうど60%は劣化ではない（< 判定）", () => {
    expect(isIndexRegression(idx(1000), idx(600), opts)).toBe(false);
  });

  it("通常の微減（>60%）は劣化ではない", () => {
    expect(isIndexRegression(idx(1000), idx(800), opts)).toBe(false);
  });

  it("増加は劣化ではない", () => {
    expect(isIndexRegression(idx(1000), idx(1200), opts)).toBe(false);
  });

  it("ちょうど floor の既存で大幅減なら劣化", () => {
    expect(isIndexRegression(idx(100), idx(40), opts)).toBe(true);
  });
});
