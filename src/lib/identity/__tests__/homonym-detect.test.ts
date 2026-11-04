import { describe, it, expect } from "vitest";
import { detectHomonymCandidates } from "../homonym-detect";

const e = (name: string, club: string, scores: [string, number][]) => ({
  athlete_name: name,
  club,
  event_scores: scores.map(([event_name, points]) => ({ event_name, points })),
});

describe("detectHomonymCandidates", () => {
  it("同じファイルに同名が2行あれば候補", () => {
    const r = detectHomonymCandidates([
      { file: "age_forest_無差別", entries: [e("山田 和輝", "KOLC", []), e("山田和輝", "神大olk", [])] },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("山田和輝");
    expect(r[0].clubs).toEqual(["KOLC", "神大olk"]);
  });

  it("別ファイルでも、所属が違い同じ大会の得点が違えば候補", () => {
    const r = detectHomonymCandidates([
      { file: "age_forest_M21", entries: [e("山田和輝", "KOLC", [["2026-10-10\n   トータス", 2317]])] },
      { file: "age_forest_M20", entries: [e("山田和輝", "神大olk", [["2026-10-10 トータス", 1963]])] },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].reasons[0]).toContain("2026-10-10 トータス");
  });

  it("同じ人（同じ得点）は所属表記が違っても候補にしない", () => {
    const r = detectHomonymCandidates([
      { file: "age_forest_M21", entries: [e("佐藤太郎", "KOLC", [["2026-01-01 A", 2500]])] },
      { file: "age_forest_無差別", entries: [e("佐藤太郎", "KOLC/練馬OLC", [["2026-01-01 A", 2500]])] },
    ]);
    expect(r).toHaveLength(0);
  });

  it("エリートと年齢別は得点の尺度が違うので比べない", () => {
    const r = detectHomonymCandidates([
      { file: "elite_forest_M21E", entries: [e("佐藤太郎", "A大", [["2026-01-01 A", 1500]])] },
      { file: "age_forest_M21", entries: [e("佐藤太郎", "A大学", [["2026-01-01 A", 2500]])] },
    ]);
    expect(r).toHaveLength(0);
  });

  it("補完行（日付なし）は比較に使わない", () => {
    const r = detectHomonymCandidates([
      { file: "age_forest_M21", entries: [e("佐藤太郎", "A", [["補完1", 2000]])] },
      { file: "age_forest_無差別", entries: [e("佐藤太郎", "B", [["補完1", 2100]])] },
    ]);
    expect(r).toHaveLength(0);
  });
});
