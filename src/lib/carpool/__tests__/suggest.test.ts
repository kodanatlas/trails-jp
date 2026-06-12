import { describe, it, expect } from "vitest";
import {
  athleteSelectionToFields,
  athleteKeyForSubmit,
  shouldQueryAthletes,
  clubSelectionToFields,
  filterClubCandidates,
} from "../suggest";
import { normalizeNameKey } from "../../name-key";

describe("athleteSelectionToFields (候補→フォーム値・指摘4)", () => {
  it("sets displayName to the canonical name and athleteKey to its normalized key", () => {
    const f = athleteSelectionToFields("山田太郎");
    expect(f.displayName).toBe("山田太郎");
    expect(f.athleteKey).toBe(normalizeNameKey("山田太郎"));
  });

  it("normalizes spaced canonical names into a space-free athleteKey", () => {
    const f = athleteSelectionToFields("山田 太郎");
    expect(f.displayName).toBe("山田 太郎");
    expect(f.athleteKey).toBe("山田太郎");
  });

  it("trims surrounding whitespace from displayName", () => {
    const f = athleteSelectionToFields("  山田太郎  ");
    expect(f.displayName).toBe("山田太郎");
    expect(f.athleteKey).toBe("山田太郎");
  });
});

describe("athleteKeyForSubmit (送信時の athleteKey 決定)", () => {
  it("returns null when no candidate was selected (free input → server auto-derives)", () => {
    expect(athleteKeyForSubmit("山田太郎", null)).toBeNull();
  });

  it("returns the canonical key when displayName matches the selection", () => {
    expect(athleteKeyForSubmit("山田太郎", "山田太郎")).toBe("山田太郎");
  });

  it("keeps the key when displayName differs only in spacing/width", () => {
    // 選択後に「姓 名」へ整形しても同一人物のキーを維持する。
    expect(athleteKeyForSubmit("山田 太郎", "山田太郎")).toBe("山田太郎");
    expect(athleteKeyForSubmit("山田　太郎", "山田太郎")).toBe("山田太郎");
  });

  it("drops the key when displayName was edited into a different person", () => {
    expect(athleteKeyForSubmit("山田次郎", "山田太郎")).toBeNull();
  });

  it("returns null for a blank selection name", () => {
    expect(athleteKeyForSubmit("山田太郎", "   ")).toBeNull();
  });
});

describe("shouldQueryAthletes (API クエリ長規則の写し)", () => {
  it("rejects empty / whitespace-only queries", () => {
    expect(shouldQueryAthletes("")).toBe(false);
    expect(shouldQueryAthletes("   ")).toBe(false);
  });

  it("requires 2+ chars for ASCII-only queries", () => {
    expect(shouldQueryAthletes("a")).toBe(false);
    expect(shouldQueryAthletes("ab")).toBe(true);
    expect(shouldQueryAthletes("1")).toBe(false);
  });

  it("allows a single non-ASCII char", () => {
    expect(shouldQueryAthletes("山")).toBe(true);
    expect(shouldQueryAthletes(" 山 ")).toBe(true);
  });
});

describe("clubSelectionToFields (候補→フォーム値)", () => {
  it("sets name and joeClubNames to the single canonical spelling", () => {
    const f = clubSelectionToFields("上尾OLC");
    expect(f.name).toBe("上尾OLC");
    expect(f.joeClubNames).toEqual(["上尾OLC"]);
  });

  it("trims the canonical name", () => {
    const f = clubSelectionToFields("  上尾OLC ");
    expect(f.name).toBe("上尾OLC");
    expect(f.joeClubNames).toEqual(["上尾OLC"]);
  });
});

describe("filterClubCandidates (インクリメンタル絞り込み)", () => {
  const ALL = ["上尾OLC", "入間市OLC", "京都大学", "東京大学", "OLCルーパー"];

  it("returns [] for an empty query (no full dump)", () => {
    expect(filterClubCandidates(ALL, "")).toEqual([]);
    expect(filterClubCandidates(ALL, "  ")).toEqual([]);
  });

  it("matches case-insensitively for ASCII (olc → OLC)", () => {
    const r = filterClubCandidates(ALL, "olc");
    expect(r).toContain("上尾OLC");
    expect(r).toContain("OLCルーパー");
  });

  it("ranks prefix matches before substring matches", () => {
    const r = filterClubCandidates(ALL, "olc");
    // "OLCルーパー" は前方一致、"上尾OLC"/"入間市OLC" は部分一致。
    expect(r[0]).toBe("OLCルーパー");
  });

  it("folds full-width input via NFKC (ＯＬＣ → olc)", () => {
    const r = filterClubCandidates(ALL, "ＯＬＣ");
    expect(r).toContain("上尾OLC");
  });

  it("matches Japanese substrings", () => {
    expect(filterClubCandidates(ALL, "大学")).toEqual(["京都大学", "東京大学"]);
    expect(filterClubCandidates(ALL, "入間")).toEqual(["入間市OLC"]);
  });

  it("ignores spaces in the query", () => {
    expect(filterClubCandidates(ALL, "入間 市")).toEqual(["入間市OLC"]);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => `クラブ${i}`);
    expect(filterClubCandidates(many, "クラブ", 8)).toHaveLength(8);
  });

  it("returns [] when nothing matches", () => {
    expect(filterClubCandidates(ALL, "存在しない")).toEqual([]);
  });
});
