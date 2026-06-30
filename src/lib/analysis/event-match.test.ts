import { describe, it, expect } from "vitest";
import { matchLcRace } from "./event-match";
import type { LapCenterPerformance } from "./types";

/** テスト用 LC パフォーマンス生成 */
function perf(
  d: string,
  e: string,
  t: "forest" | "sprint",
  c = "MA",
): LapCenterPerformance {
  return { d, e, c, s: 95, m: 5, t };
}

describe("matchLcRace", () => {
  it("同日×同種目の単一レースに突合する（従来挙動）", () => {
    const lc = [perf("2026-05-31", "早大OC", "forest")];
    expect(matchLcRace(lc, "2026-05-31", "早大OC", "forest", 1)).toBe(lc[0]);
  });

  it("同日に LC レースが無ければ null", () => {
    const lc = [perf("2026-05-31", "早大OC", "forest")];
    expect(matchLcRace(lc, "2026-06-01", "千葉大", "forest", 1)).toBeNull();
  });

  it("種目が食い違っても、その日1大会・ランキングも1大会なら同一レースとして突合する（前日大会の重複解消）", () => {
    // 2026-06-13: ランキング=「東大大会前日」(sprint) / LC=「第48回東大OLK大会前日大会」(forest)
    const lc = [
      perf("2026-06-13", "第48回東大OLK大会前日大会", "forest", "Extra"),
      perf("2026-06-13", "第48回東大OLK大会前日大会", "forest", "L1"),
    ];
    const m = matchLcRace(lc, "2026-06-13", "東大大会前日", "sprint", 1);
    expect(m).not.toBeNull();
    expect(m?.e).toBe("第48回東大OLK大会前日大会");
  });

  it("ランキング側がその日2大会なら、種目跨ぎの単一性フォールバックは抑止する（取り違え防止）", () => {
    const lc = [perf("2026-06-13", "第48回東大OLK大会前日大会", "forest")];
    // 同日に別のスプリント大会もランキングにある → rankedEventsOnDate=2
    expect(matchLcRace(lc, "2026-06-13", "東大大会前日", "sprint", 2)).toBeNull();
  });

  it("種目跨ぎでも大会名が近似一致すれば突合する（名前アンカー・rankedCount に依存しない）", () => {
    const lc = [perf("2026-02-22", "千葉大大会", "forest")];
    // 大会名は近似一致（「千葉大」⊂「千葉大大会」）。同日2大会でも名前一致なら拾える。
    expect(matchLcRace(lc, "2026-02-22", "千葉大", "sprint", 2)).toBe(lc[0]);
  });

  it("同種目に単一レースがあれば名前不一致でも突合する（従来挙動: 複数クラス出走＝同一レース）", () => {
    const lc = [perf("2026-07-01", "B大会", "forest")];
    // 同日×同種目に1レースだけなら、名前が違っても同一レースとみなす（既存仕様）
    expect(matchLcRace(lc, "2026-07-01", "無関係大会", "forest", 1)).toBe(lc[0]);
  });

  it("同日同種目に別レースが複数あり名前一致しなければ抑止する（誤遷移防止）", () => {
    const lc = [
      perf("2026-07-01", "X大会", "forest"),
      perf("2026-07-01", "Y大会", "forest"),
    ];
    expect(matchLcRace(lc, "2026-07-01", "無関係大会", "forest", 1)).toBeNull();
  });

  it("種目跨ぎでも、同日に別レースが複数あり名前近似も無ければ抑止する（誤遷移防止）", () => {
    const lc = [
      perf("2026-07-01", "X大会", "forest"),
      perf("2026-07-01", "Y大会", "forest"),
    ];
    // 同種目(sprint)の LC は無く、forest が2大会 → 単一性フォールバック不成立・名前近似も無し
    expect(matchLcRace(lc, "2026-07-01", "無関係大会", "sprint", 1)).toBeNull();
  });

  it("同日同種目に別レースが複数あれば大会名で一意化する（従来挙動）", () => {
    const lc = [
      perf("2026-07-01", "X大会", "forest"),
      perf("2026-07-01", "Y大会", "forest"),
    ];
    expect(matchLcRace(lc, "2026-07-01", "Y大会", "forest", 1)?.e).toBe("Y大会");
  });

  it("lcData が null でも安全に null を返す", () => {
    expect(matchLcRace(null, "2026-06-13", "東大大会前日", "sprint", 1)).toBeNull();
  });
});
