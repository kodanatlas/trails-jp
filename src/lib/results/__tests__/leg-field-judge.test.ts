import { describe, it, expect } from "vitest";
import { judgeLegAgainstField, medianOf, FIELD_JUDGE_MIN_N } from "../leg-field-judge";
import { buildFieldRows } from "../../../app/results/[eventId]/[classId]/FieldComparisonCard";
import type { LegView, LegCell } from "../leg-analysis";

// 罠レッグ vs 自分のミス（フィールド比較）の共有判定。結果分析ページとミスの傾向の一覧が同じ関数を使う。
// docs/plans/2026-09-30_miss-trend-field-comparison.md

const eight = (v: number) => Array.from({ length: FIELD_JUDGE_MIN_N }, () => v);

describe("medianOf", () => {
  it("奇数は中央・偶数は中央2つの平均・空は null", () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 2, 3])).toBe(2.5);
    expect(medianOf([])).toBeNull();
  });
});

describe("judgeLegAgainstField", () => {
  it("下限未満は判定しない・下限ちょうどは対象（ミス判定の「下限以上」と揃える）", () => {
    expect(judgeLegAgainstField(9, eight(30), "forest")).toEqual({ kind: "below-floor" });
    expect(judgeLegAgainstField(10, eight(30), "forest").kind).toBe("judged");
    expect(judgeLegAgainstField(4, eight(30), "sprint")).toEqual({ kind: "below-floor" });
    expect(judgeLegAgainstField(5, eight(30), "sprint").kind).toBe("judged");
  });

  it("比べる相手がいなければ no-field", () => {
    expect(judgeLegAgainstField(40, [], "forest")).toEqual({ kind: "no-field" });
  });

  it("コース起因＝中央値（0〜本人のロスに収める）・自分の超過＝本人のロス − コース起因", () => {
    const j = judgeLegAgainstField(40, eight(30), "forest");
    expect(j).toMatchObject({ kind: "judged", fieldMedian: 30, fieldN: 8, course: 30, own: 10 });
    // 中央値が負（フィールドは速い）→ コース起因 0
    expect(judgeLegAgainstField(40, eight(-5), "forest")).toMatchObject({ course: 0, own: 40 });
    // 中央値が本人より大きい → コース起因は本人のロスで頭打ち
    expect(judgeLegAgainstField(40, eight(90), "forest")).toMatchObject({ course: 40, own: 0 });
  });

  it("ラベル: コース起因の割合 0.5 以上＝罠レッグ・0.2 以下＝自分のミス・中間＝半々（境界ちょうどを含む）", () => {
    expect(judgeLegAgainstField(40, eight(20), "forest")).toMatchObject({ verdict: "trap" }); // 0.5
    expect(judgeLegAgainstField(40, eight(8), "forest")).toMatchObject({ verdict: "own" }); // 0.2
    expect(judgeLegAgainstField(40, eight(12), "forest")).toMatchObject({ verdict: "mixed" }); // 0.3
  });

  it("比べる相手が 8 人未満ならラベルは出さない（数値は出す）", () => {
    const j = judgeLegAgainstField(40, eight(30).slice(0, 7), "forest");
    expect(j).toMatchObject({ kind: "judged", fieldN: 7, course: 30, own: 10, verdict: null });
  });

  it("結果分析ページの表示行: ロス上位 6 本＋ミスの傾向から来たレッグ（6 本外でも必ず含める）", () => {
    // レッグ i のロス = 100 - 5i 秒（全部下限以上）・フィールド中央値 20・相手 10 人
    const legs = Array.from({ length: 10 }, (_, i) => ({
      label: `${i}→${i + 1}`,
      lossSec: 100 - 5 * i,
      fieldMedianLossSec: 20,
      fieldN: 10,
    })) as unknown as LegCell[];
    const view = { legs, n: 11 } as unknown as LegView;
    expect(buildFieldRows(view, "forest", null).map((r) => r.i)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(buildFieldRows(view, "forest", 8).map((r) => r.i)).toEqual([0, 1, 2, 3, 4, 5, 8]);
    expect(buildFieldRows(view, "forest", 2).map((r) => r.i)).toEqual([0, 1, 2, 3, 4, 5]); // 既に上位 6 本の中
  });

  it("中央値が .5 のときも丸めずに割合を出す（境界の取り違えを防ぐ）", () => {
    // 相手 8 人の中央値 = (9 + 10) / 2 = 9.5 → 割合 9.5/40 = 0.2375 → 半々（丸めて 10 にすると 0.25 で同じだが、
    // 8 に丸めると 0.2 で「自分のミス」になってしまう）
    const others = [9, 9, 9, 9, 10, 10, 10, 10];
    expect(judgeLegAgainstField(40, others, "forest")).toMatchObject({ fieldMedian: 9.5, verdict: "mixed" });
  });
});
