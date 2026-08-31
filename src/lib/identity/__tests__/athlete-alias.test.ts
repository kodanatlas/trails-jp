import { describe, expect, it } from "vitest";
import {
  resolveAliasName,
  resolveAliasNameForLc,
  resolveEntryAliases,
  validateAliases,
  type AthleteAlias,
} from "../athlete-alias";

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

  it("学年数字つきの筑波大学を筑波側の別名へ解決する", () => {
    expect(resolveAliasName("鈴木健太", ["筑波大学1"])).toEqual({
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

  it("大学附属高校を大学本体へ誤マッチしない", () => {
    expect(resolveAliasName("鈴木健太", ["筑波大学附属高等学校"])).toEqual({
      kind: "unresolved",
    });
  });

  it("金沢という地名だけでは金沢大学へ解決しない", () => {
    expect(resolveAliasName("鈴木健太", ["金沢"])).toEqual({ kind: "unresolved" });
  });

  it("対応表に無い所属は未解決のままにする", () => {
    expect(resolveAliasName("鈴木健太", ["ときわ走林会"])).toEqual({
      kind: "unresolved",
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

describe("resolveEntryAliases", () => {
  it("未解決の行を破棄せず元の氏名で素通しする", () => {
    const entry = {
      athlete_name: "鈴木健太",
      club: "ときわ走林会",
      rank: 1,
    };
    expect(resolveEntryAliases([entry])).toEqual({
      entries: [entry],
      renamed: 0,
      passthrough: 1,
    });
  });
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

  it.each([
    [29, 36],
    [16, 27],
  ])("event 9983 class %i のoverrideをrunnerIndex %iにだけ適用する", (lcClassId, runnerIndex) => {
    expect(resolveAliasNameForLc("鈴木 健太", [], 9983, lcClassId, runnerIndex)).toEqual({
      kind: "renamed",
      name: "鈴木健太（金沢大学）",
    });
    expect(resolveAliasNameForLc("鈴木 健太", [], 9983, lcClassId, runnerIndex + 1)).toEqual({
      kind: "unresolved",
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

describe("validateAliases", () => {
  it("identity間で正規化後のクラブ集合が重複する表を拒否する", () => {
    const invalid = [
      {
        sourceName: "同姓同名",
        identities: [
          { displayName: "同姓同名（1）", clubs: ["金沢大学"] },
          { displayName: "同姓同名（2）", clubs: ["金大OLC"] },
        ],
        lcOverrides: [],
      },
    ] satisfies AthleteAlias[];

    expect(() => validateAliases(invalid)).toThrow(/Overlapping athlete alias club/);
  });
});
