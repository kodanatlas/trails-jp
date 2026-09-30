/**
 * 難レッグ vs 自分のミス（フィールド比較）の共有判定。結果分析ページとミスの傾向の一覧が同じ関数を使う
 * （同じルールで判定する＝ページ間で基準が食い違わない。値の出所はページごとに違いうる）。
 * docs/plans/2026-09-30_miss-trend-field-comparison.md
 *
 * - 比べる相手＝本人を除く同じクラスの完走者のうち、そのレッグの値がある人（レッグ別の有効数）
 * - 対象＝本人のロスが下限以上（ミス判定の「下限以上」と揃える）
 * - コース起因＝相手の中央値を 0〜本人のロスに収めた値。自分の超過＝本人のロス − コース起因
 * - コース起因の割合 ≥ 0.5 → 難レッグ／≤ 0.2 → 自分のミス／中間 → 半々。相手が 8 人未満ならラベルなし
 * 中央値による目安で、原因（ナビミスか地形か集団走か）の断定ではない（方法論 §92）。
 */

export const FIELD_JUDGE_MIN_N = 8;
export const FIELD_JUDGE_FLOOR = { forest: 10, sprint: 5 } as const;
const TRAP_RATIO = 0.5;
const OWN_RATIO = 0.2;

export type FieldVerdict = "trap" | "own" | "mixed";

export type FieldJudgement =
  | { kind: "below-floor" }
  | { kind: "no-field" }
  | {
      kind: "judged";
      fieldMedian: number;
      fieldN: number;
      course: number;
      own: number;
      /** 相手が FIELD_JUDGE_MIN_N 人未満なら null（数値の内訳だけ出す） */
      verdict: FieldVerdict | null;
    };

export function medianOf(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 中央値と人数が既にあるとき（結果分析ページの LegView）の判定 */
export function judgeFromMedian(
  yourLoss: number,
  fieldMedian: number | null,
  fieldN: number,
  discipline: "forest" | "sprint"
): FieldJudgement {
  if (yourLoss < FIELD_JUDGE_FLOOR[discipline]) return { kind: "below-floor" };
  if (fieldMedian == null || fieldN === 0) return { kind: "no-field" };
  const course = Math.max(0, Math.min(fieldMedian, yourLoss));
  const own = yourLoss - course;
  const ratio = yourLoss > 0 ? course / yourLoss : 0;
  const verdict: FieldVerdict | null =
    fieldN < FIELD_JUDGE_MIN_N ? null : ratio >= TRAP_RATIO ? "trap" : ratio <= OWN_RATIO ? "own" : "mixed";
  return { kind: "judged", fieldMedian, fieldN, course, own, verdict };
}

/** 比べる相手（本人を除く完走者）の値の一覧からの判定（ビルドの明細生成が使う） */
export function judgeLegAgainstField(
  yourLoss: number,
  others: readonly number[],
  discipline: "forest" | "sprint"
): FieldJudgement {
  return judgeFromMedian(yourLoss, medianOf(others), others.length, discipline);
}
