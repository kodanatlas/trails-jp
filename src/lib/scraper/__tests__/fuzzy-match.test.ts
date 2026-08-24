import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "../lapcenter";

describe("fuzzyMatch: JOY と LapCenter の恒常的な表記差", () => {
  it.each([
    [
      "金沢市民オリエンテーリング大会",
      "（令和８年度）第69回金沢市民スポーツ大会オリエンテーリング競技",
    ],
    [
      "中高選手権　団体オープン競技",
      "第40回全国中学校高等学校オリエンテーリング選手権大会",
    ],
    [
      "彩の森入間公園OL体験会＆併設ロゲ",
      "第55回(26年度7月度) 入間市オリエンテーリング体験会",
    ],
  ])("%s と %s を同一大会と判定する", (joyName, lapCenterName) => {
    expect(fuzzyMatch(joyName, lapCenterName)).toBe(true);
  });

  it.each([
    [
      "第49回霧ヶ峰オリエンテーリング大会",
      "（令和８年度）第78回石川県民スポーツ大会オリエンテーリング競技",
    ],
    ["千葉大OLC 技術局練習会", "入間市OLC夏合宿 Day2"],
    [
      "金沢市民オリエンテーリング大会",
      "（令和８年度）第78回石川県民スポーツ大会オリエンテーリング競技",
    ],
  ])("%s と %s を別大会と判定する", (joyName, lapCenterName) => {
    expect(fuzzyMatch(joyName, lapCenterName)).toBe(false);
  });
});
