import { describe, it, expect } from "vitest";
import {
  buildSelfPickChoices,
  filterSelfPickChoices,
  normalizeSelfPickQuery,
  type SelfPickDetectedInput,
  type SelfPickMemberInput,
  type SelfPickParticipationInput,
} from "../self-pick";

const members: SelfPickMemberInput[] = [
  { id: "m-yamada", displayName: "山田太郎", active: true },
  { id: "m-kodama", displayName: "児玉健", active: true },
  { id: "m-suzuki", displayName: "鈴木一郎", active: true },
  { id: "m-old", displayName: "退会者", active: false },
];

const detected: SelfPickDetectedInput[] = [
  { nameKey: "山田太郎", memberId: "m-yamada", rawName: "山田 太郎", className: "M21A" },
  { nameKey: "新規花子", memberId: null, rawName: "新規 花子", className: "W21A" },
];

const participations: SelfPickParticipationInput[] = [
  { memberId: "m-yamada", role: "driver" },
  { memberId: "m-suzuki", role: "rider" },
];

describe("buildSelfPickChoices (統合 + 重複なし)", () => {
  it("検出+登録済み+activeメンバーを重複なく統合する", () => {
    const out = buildSelfPickChoices(detected, members, participations);
    const keys = out.map((c) => c.key);
    // 山田(検出+登録)は1回だけ・新規花子(未登録検出)・鈴木(登録のみ)・児玉(メンバーのみ)
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
    expect(keys).toContain("m-yamada");
    expect(keys).toContain("det:新規花子");
    expect(keys).toContain("m-suzuki");
    expect(keys).toContain("m-kodama");
  });

  it("非activeメンバーは含めない（検出/登録に居なければ）", () => {
    const out = buildSelfPickChoices(detected, members, participations);
    expect(out.find((c) => c.memberId === "m-old")).toBeUndefined();
  });

  it("検出由来は clubMatched=true で先頭グループに来る", () => {
    const out = buildSelfPickChoices(detected, members, participations);
    const matched = out.filter((c) => c.clubMatched);
    const unmatched = out.filter((c) => !c.clubMatched);
    expect(matched.map((c) => c.key).sort()).toEqual(["det:新規花子", "m-yamada"]);
    // 配列順: clubMatched 全員が先
    expect(out.slice(0, matched.length).every((c) => c.clubMatched)).toBe(true);
    expect(out.slice(matched.length).every((c) => !c.clubMatched)).toBe(true);
    expect(unmatched).toHaveLength(2);
  });

  it("グループ内は氏名順（ja）", () => {
    const out = buildSelfPickChoices(detected, members, participations);
    const unmatchedNames = out.filter((c) => !c.clubMatched).map((c) => c.displayName);
    const sorted = [...unmatchedNames].sort((a, b) => a.localeCompare(b, "ja"));
    expect(unmatchedNames).toEqual(sorted);
  });

  it("既存 participation の role を引き継ぐ（未登録は null）", () => {
    const out = buildSelfPickChoices(detected, members, participations);
    expect(out.find((c) => c.key === "m-yamada")?.role).toBe("driver");
    expect(out.find((c) => c.key === "m-suzuki")?.role).toBe("rider");
    expect(out.find((c) => c.key === "det:新規花子")?.role).toBeNull();
    expect(out.find((c) => c.key === "m-kodama")?.role).toBeNull();
  });

  it("突合済み検出は member 表示名を優先・未登録は rawName > nameKey", () => {
    const out = buildSelfPickChoices(detected, members, participations);
    expect(out.find((c) => c.key === "m-yamada")?.displayName).toBe("山田太郎");
    expect(out.find((c) => c.key === "det:新規花子")?.displayName).toBe("新規 花子");
  });

  it("未登録検出はクイック登録用の detected 情報を持つ", () => {
    const out = buildSelfPickChoices(detected, members, participations);
    const c = out.find((x) => x.key === "det:新規花子");
    expect(c?.detected).toEqual({
      nameKey: "新規花子",
      className: "W21A",
      rawName: "新規 花子",
    });
    expect(c?.memberId).toBeNull();
  });

  it("member 不明の participation は無視する（壊れ参照でカードを汚さない）", () => {
    const out = buildSelfPickChoices([], members, [{ memberId: "ghost", role: "rider" }]);
    expect(out.find((c) => c.memberId === "ghost")).toBeUndefined();
  });
});

describe("normalizeSelfPickQuery / filterSelfPickChoices", () => {
  it("空白（全角含む）を無視して部分一致する", () => {
    const out = buildSelfPickChoices(detected, members, participations);
    expect(filterSelfPickChoices(out, "山田 太").map((c) => c.key)).toEqual(["m-yamada"]);
    expect(filterSelfPickChoices(out, "新規花子").map((c) => c.key)).toEqual(["det:新規花子"]);
  });

  it("空クエリは全件・順序維持", () => {
    const out = buildSelfPickChoices(detected, members, participations);
    expect(filterSelfPickChoices(out, "  ")).toEqual(out);
  });

  it("ヒットなしは空配列", () => {
    const out = buildSelfPickChoices(detected, members, participations);
    expect(filterSelfPickChoices(out, "存在しない名前")).toEqual([]);
  });

  it("normalize: 全角空白除去 + ASCII 小文字化", () => {
    expect(normalizeSelfPickQuery(" Ｙａｍａ　da ")).toBe("ｙａｍａda");
  });
});
