"use client";

import { fmtSignedSeconds, type LegView } from "@/lib/results/leg-analysis";
import {
  FIELD_JUDGE_FLOOR,
  FIELD_JUDGE_MIN_N,
  judgeFromMedian,
  type FieldVerdict,
} from "@/lib/results/leg-field-judge";

/**
 * 罠レッグ vs 自分のミス: 自分の各ロスを「コース起因（本人を除く完走者の中央値）＋自分の超過」に分解する。
 * 判定は leg-field-judge.ts の共有関数（ミスの傾向の一覧と同じルール）。比べる相手が 8 人未満のレッグは
 * ラベルを出さず数値だけ（docs/plans/2026-09-30_miss-trend-field-comparison.md）。
 * ロスの大きい順に上位 6 本。ミスの傾向の一覧から来たレッグ（focusLeg）は 6 本の外でも必ず含める。
 */

const TOP_N = 6;

interface Row {
  i: number;
  label: string;
  your: number;
  course: number;
  own: number;
  verdict: FieldVerdict | null;
}

/** 表示する行: 判定対象（下限以上・比べる相手あり）のうちロス上位 6 本＋focusLeg（6 本外でも必ず） */
export function buildFieldRows(view: LegView, discipline: "forest" | "sprint", focusLeg: number | null): Row[] {
  const all: Row[] = view.legs.flatMap((l, i) => {
    // 中央値と人数は buildLegView が本人を除いて計算済み。判定は共有関数で行う
    const j = judgeFromMedian(l.lossSec, l.fieldMedianLossSec, l.fieldN, discipline);
    if (j.kind !== "judged") return [];
    return [{ i, label: l.label, your: l.lossSec, course: j.course, own: j.own, verdict: j.verdict }];
  });
  const top = [...all].sort((a, b) => b.your - a.your).slice(0, TOP_N);
  const focus = focusLeg != null ? all.find((r) => r.i === focusLeg) : undefined;
  return focus && !top.some((r) => r.i === focus.i) ? [...top, focus] : top;
}

const VERDICT_TEXT: Record<FieldVerdict, string> = { trap: "罠レッグ", own: "自分のミス", mixed: "半々" };
const VERDICT_TONE: Record<FieldVerdict, string> = { trap: "text-warning", own: "text-red-400", mixed: "text-muted" };

export function FieldComparisonCard({
  view,
  discipline,
  focusLeg,
}: {
  view: LegView;
  discipline: "forest" | "sprint";
  focusLeg: number | null;
}) {
  if (view.n < 5) return null;
  const rows = buildFieldRows(view, discipline, focusLeg);
  if (rows.length === 0) return null;
  const labeled = rows.some((r) => r.verdict != null);
  const totCourse = rows.reduce((s, r) => s + r.course, 0);
  const totOwn = rows.reduce((s, r) => s + r.own, 0);
  const floor = FIELD_JUDGE_FLOOR[discipline];

  return (
    <div className="mt-5 rounded-2xl border border-border bg-card p-4">
      <p className="text-[11px] tracking-wider text-muted">
        {labeled ? "罠レッグ vs 自分のミス" : "ロスの内訳（フィールド中央値との比較・参考）"}
      </p>
      {labeled ? (
        <p className="mb-2 text-[10px] text-muted/80">
          各ロスをフィールド全体と比較。フィールドも遅い＝<span className="text-warning">罠レッグ（コース要因）</span>／フィールドは速いのに自分だけ＝<span className="text-red-400">自分のミス</span>。
        </p>
      ) : (
        <p className="mb-2 text-[10px] text-muted/80">
          比べられる完走者が {FIELD_JUDGE_MIN_N} 名未満のため、罠レッグ／自分のミスのラベル判定は行いません。内訳は参考値です。
        </p>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
        <span className="text-muted">上位ロスの内訳:</span>
        <span className="text-warning">コース起因 {fmtSignedSeconds(totCourse)}</span>
        <span className="text-red-400">自分の超過 {fmtSignedSeconds(totOwn)}</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => {
          const cw = r.your > 0 ? (r.course / r.your) * 100 : 0;
          return (
            <div key={r.i} className={`flex items-center gap-2 text-xs ${r.i === focusLeg ? "rounded bg-primary/10" : ""}`}>
              <span className="w-12 flex-shrink-0 font-mono text-muted">{r.label}</span>
              <span className="w-12 flex-shrink-0 text-right font-mono font-bold text-red-400">{fmtSignedSeconds(r.your)}</span>
              <div
                className="flex h-2 flex-1 overflow-hidden rounded-full bg-border"
                title={`コース起因 ${fmtSignedSeconds(r.course)} / 自分の超過 ${fmtSignedSeconds(r.own)}`}
              >
                <div className="h-full bg-warning/70" style={{ width: `${cw}%` }} />
                <div className="h-full bg-red-400/80" style={{ width: `${100 - cw}%` }} />
              </div>
              {labeled && (
                <span className={`w-16 flex-shrink-0 text-right text-[10px] font-bold ${r.verdict ? VERDICT_TONE[r.verdict] : "text-muted/60"}`}>
                  {r.verdict ? VERDICT_TEXT[r.verdict] : "—"}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[9px] text-muted/70">
        コース起因 ≈ 本人を除く完走者のロス中央値、自分の超過 = 自分のロス − コース起因。
        対象はロスが{floor}秒（{discipline === "sprint" ? "スプリント" : "フォレスト"}の下限）以上のレッグ。
        {labeled &&
          `判定: コース起因の割合が5割以上=罠レッグ / 2割以下=自分のミス / 中間=半々（比べられる完走者が${FIELD_JUDGE_MIN_N}名以上のレッグのみ）。`}
        LapCenter/WinSplits はフィールド分布を出さないため trails.jp 独自の分解。
      </p>
    </div>
  );
}
