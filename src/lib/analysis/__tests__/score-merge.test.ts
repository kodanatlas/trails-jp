import { describe, expect, it } from "vitest";
import { findDuplicateNames, makeScoreMergeKey } from "../score-merge";

describe("score merge key", () => {
  it("重複しない氏名は氏名のみをキーにする", () => {
    expect(
      makeScoreMergeKey(
        { athlete_name: "奈良崎有香", club: "横浜国立大学4" },
        new Set(),
      ),
    ).toBe("奈良崎有香");
  });

  it("同一ファイル内の同名2行を検出する", () => {
    const duplicateNames = findDuplicateNames([
      { athlete_name: "同姓同名" },
      { athlete_name: "別の選手" },
      { athlete_name: "同姓同名" },
    ]);

    expect(duplicateNames).toEqual(new Set(["同姓同名"]));
  });

  it("検出された氏名は所属込みのキーにフォールバックする", () => {
    expect(
      makeScoreMergeKey(
        { athlete_name: "同姓同名", club: "筑波大学" },
        new Set(["同姓同名"]),
      ),
    ).toBe("同姓同名 筑波大学");
  });

  it("進級で所属が変わっても重複名でなければ同じキーになる", () => {
    const duplicateNames = new Set<string>();

    expect(
      makeScoreMergeKey(
        { athlete_name: "進級選手", club: "東北大学2" },
        duplicateNames,
      ),
    ).toBe(
      makeScoreMergeKey(
        { athlete_name: "進級選手", club: "東北大学3" },
        duplicateNames,
      ),
    );
  });

  it("所属が空文字でも氏名キーを維持する", () => {
    expect(
      makeScoreMergeKey(
        { athlete_name: "無所属選手", club: "" },
        new Set(),
      ),
    ).toBe("無所属選手");
  });

  it("井戸康の同一クラブ2行を重複名として検出する", () => {
    const entries = [
      { athlete_name: "井戸康", club: "東京大学" },
      { athlete_name: "井戸康", club: "東京大学" },
    ];
    const duplicateNames = findDuplicateNames(entries);

    expect(duplicateNames.has("井戸康")).toBe(true);
  });
});
