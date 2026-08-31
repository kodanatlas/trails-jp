import { describe, expect, it } from "vitest";
import { resolveAliasName, resolveAliasNameForLc } from "../athlete-alias";

describe("resolveAliasName", () => {
  it("表に無い氏名は元の名前を変えない", () => {
    expect(resolveAliasName("田中 創", ["大阪/レオ/練馬/羅針盤"])).toEqual({
      kind: "unchanged",
      name: "田中 創",
    });
  });

  it("筑波大学を筑波側の別名へ解決する", () => {
    expect(resolveAliasName("鈴木健太", ["筑波大学"])).toEqual({
      kind: "renamed",
      name: "鈴木健太（筑波大学）",
    });
  });

  it("筑波大を筑波側の別名へ解決する", () => {
    expect(resolveAliasName("鈴木健太", ["筑波大"])).toEqual({
      kind: "renamed",
      name: "鈴木健太（筑波大学）",
    });
  });

  it("筑波大学51期Aを筑波側の別名へ解決する", () => {
    expect(resolveAliasName("鈴木健太", ["筑波大学51期A"])).toEqual({
      kind: "renamed",
      name: "鈴木健太（筑波大学）",
    });
  });

  it("学年数字つきの金沢大学を金沢側の別名へ解決する", () => {
    expect(resolveAliasName("鈴木 健太", ["金沢大学3"])).toEqual({
      kind: "renamed",
      name: "鈴木健太（金沢大学）",
    });
  });

  it("金大OLCを金沢側の別名へ解決する", () => {
    expect(resolveAliasName("鈴木健太", ["金大OLC"])).toEqual({
      kind: "renamed",
      name: "鈴木健太（金沢大学）",
    });
  });

  it("金大を金沢側の別名へ解決する", () => {
    expect(resolveAliasName("鈴木健太", ["金大"])).toEqual({
      kind: "renamed",
      name: "鈴木健太（金沢大学）",
    });
  });

  it("別人の多所属文字列を氏名として分割しない", () => {
    expect(resolveAliasName("田中創", ["大阪/レオ/練馬/羅針盤"])).toEqual({
      kind: "unchanged",
      name: "田中創",
    });
  });

  it("対象氏名の所属が空なら解決しない", () => {
    expect(resolveAliasName("鈴木健太", [])).toEqual({ kind: "unresolved" });
  });

  it("複数のidentityに該当する所属なら解決しない", () => {
    expect(resolveAliasName("鈴木健太", ["筑波大学/金沢大学"])).toEqual({
      kind: "unresolved",
    });
  });

  it.each(["鈴木健太（筑波大学）", "鈴木健太（金沢大学）"])(
    "改名済みの%sは再適用しても変えない",
    (displayName) => {
      expect(resolveAliasName(displayName, ["筑波大学/金沢大学"])).toEqual({
        kind: "unchanged",
        name: displayName,
      });
    },
  );
});

describe("resolveAliasNameForLc", () => {
  it("LC overrideを所属照合より優先する", () => {
    expect(resolveAliasNameForLc("鈴木 健太", ["金沢大学"], 9435, 11, 54)).toEqual({
      kind: "renamed",
      name: "鈴木健太（筑波大学）",
    });
  });

  it("runnerIndex指定ありのoverrideはindex不一致なら適用しない", () => {
    expect(resolveAliasNameForLc("鈴木 健太", ["金沢大学"], 9435, 11, 55)).toEqual({
      kind: "renamed",
      name: "鈴木健太（金沢大学）",
    });
  });

  it.each(["鈴木健太（筑波大学）", "鈴木健太（金沢大学）"])(
    "改名済みの%sはLC解決を再適用しても変えない",
    (displayName) => {
      expect(resolveAliasNameForLc(displayName, ["筑波大学/金沢大学"], 9435, 11, 54)).toEqual({
        kind: "unchanged",
        name: displayName,
      });
    },
  );
});
