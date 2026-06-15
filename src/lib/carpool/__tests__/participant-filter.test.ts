import { describe, it, expect } from "vitest";
import {
  detectedDisplayName,
  normalizeNameQuery,
  matchesNameQuery,
  sortDetectedByName,
  filterDetectedByName,
  type DetectedNameInput,
} from "../participant-filter";

const detected: DetectedNameInput[] = [
  { nameKey: "山田太郎", rawName: "山田 太郎" },
  { nameKey: "新規花子", rawName: "新規 花子" },
  { nameKey: "鈴木一郎", rawName: null },
  { nameKey: "児玉健", rawName: "" },
];

describe("detectedDisplayName", () => {
  it("rawName を優先・空/未指定なら nameKey にフォールバック", () => {
    expect(detectedDisplayName({ nameKey: "山田太郎", rawName: "山田 太郎" })).toBe(
      "山田 太郎",
    );
    expect(detectedDisplayName({ nameKey: "鈴木一郎", rawName: null })).toBe("鈴木一郎");
    expect(detectedDisplayName({ nameKey: "児玉健", rawName: "  " })).toBe("児玉健");
    expect(detectedDisplayName({ nameKey: "佐藤" })).toBe("佐藤");
  });
});

describe("normalizeNameQuery", () => {
  it("全角空白除去 + ASCII 小文字化", () => {
    expect(normalizeNameQuery(" Ｙａｍａ　da ")).toBe("ｙａｍａda");
    expect(normalizeNameQuery("山田 太郎")).toBe("山田太郎");
  });
});

describe("matchesNameQuery", () => {
  it("空白（全角含む）を無視して部分一致する", () => {
    expect(matchesNameQuery("山田 太郎", "山田太")).toBe(true);
    expect(matchesNameQuery("山田太郎", "山田 太")).toBe(true);
  });

  it("空クエリは常に true（絞り込まない）", () => {
    expect(matchesNameQuery("誰でも", "")).toBe(true);
    expect(matchesNameQuery("誰でも", "　 ")).toBe(true);
  });

  it("ヒットしなければ false", () => {
    expect(matchesNameQuery("山田太郎", "鈴木")).toBe(false);
  });

  it("ASCII は大文字小文字を無視", () => {
    expect(matchesNameQuery("Yamada", "yama")).toBe(true);
  });
});

describe("sortDetectedByName", () => {
  it("氏名順（ja）に並び替え・元配列は変更しない", () => {
    const before = [...detected];
    const out = sortDetectedByName(detected);
    const names = out.map(detectedDisplayName);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, "ja"));
    expect(names).toEqual(sorted);
    // 元配列は不変
    expect(detected).toEqual(before);
  });
});

describe("filterDetectedByName", () => {
  it("表示名（rawName > nameKey）で部分一致絞込", () => {
    expect(filterDetectedByName(detected, "新規").map((d) => d.nameKey)).toEqual([
      "新規花子",
    ]);
    // rawName が無い行は nameKey で当たる
    expect(filterDetectedByName(detected, "鈴木").map((d) => d.nameKey)).toEqual([
      "鈴木一郎",
    ]);
  });

  it("空クエリは全件をそのまま返す（順序維持）", () => {
    expect(filterDetectedByName(detected, "  ").map((d) => d.nameKey)).toEqual(
      detected.map((d) => d.nameKey),
    );
  });

  it("ヒットなしは空配列", () => {
    expect(filterDetectedByName(detected, "存在しない")).toEqual([]);
  });
});
