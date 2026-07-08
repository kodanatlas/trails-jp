"use client";

import { useEffect, useState } from "react";
import type { CrossRaceIndex, CrossRaceEntry } from "@/lib/analysis/cross-race";

// アーティファクトは全選手共通なのでセッション中1回だけ fetch する
let crossRacePromise: Promise<CrossRaceIndex | null> | null = null;
function loadCrossRace(): Promise<CrossRaceIndex | null> {
  crossRacePromise ??= fetch("/data/cross-race.json")
    .then((r) => (r.ok ? (r.json() as Promise<CrossRaceIndex>) : null))
    .then((idx) => (idx && idx.generatedAt ? idx : null))
    .catch(() => null);
  return crossRacePromise;
}

/** 百分位 → 10% 幅の帯表示（n=5 の小標本で精密な数値に見せない） */
function pctBand(pct: number): string {
  const lo = Math.min(91, Math.floor((pct - 1) / 10) * 10 + 1);
  return `${lo}〜${lo + 9}%`;
}

function DisciplineRow({
  label,
  entry,
  fitAthletes,
  q3Miss,
}: {
  label: string;
  entry: CrossRaceEntry;
  fitAthletes: number;
  q3Miss: number;
}) {
  const diff = Math.round((entry.miss - entry.exp) * 10) / 10;
  // |z| < 0.25 は誤差の範囲として中立表示（微小差を「多い/少ない」と断定しない）
  const neutral = Math.abs(entry.z) < 0.25;
  const better = !neutral && diff < 0;
  const worse = !neutral && diff > 0;
  return (
    <div className="rounded-lg bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-[10px] text-muted">
          n={entry.n}レース / 対象{fitAthletes}選手
        </p>
      </div>
      <p className="mt-2 text-sm">
        レース毎ミス率の中央値 <span className="font-mono font-bold">{entry.miss}%</span>
        <span className="text-muted"> ／ 同水準の巡航速度指標帯の期待値 {entry.exp}%</span>
      </p>
      <p className={`mt-0.5 text-sm font-bold ${better ? "text-green-400" : worse ? "text-red-400" : ""}`}>
        差 {diff > 0 ? "+" : ""}
        {diff}pp（{better ? "期待よりミスが少ない" : worse ? "期待よりミスが多い" : "ほぼ期待どおり"}）
      </p>
      <div className="mt-2">
        <p className="text-xs text-muted">
          ミスの少なさ: 対象選手中 上位{pctBand(entry.pct)}（目安）
        </p>
        <div className="relative mt-1 h-1.5 rounded-full bg-white/10">
          <div
            className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded bg-primary"
            style={{ left: `${entry.pct}%` }}
          />
        </div>
        <div className="mt-0.5 flex justify-between text-[9px] text-muted">
          <span>ミスが少ない</span>
          <span>ミスが多い</span>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        高ミス率レース: {entry.blow}/{entry.n}
        <span className="text-[10px]">（種目内ミス率の上位四分位＝{q3Miss}%以上）</span>
      </p>
      {(() => {
        // 1行解釈（参考・断定しない）: 中央値の帯位置 × 大崩れ頻度（構成上の期待=25%）の組合せ。
        // n が小さいと頻度の解釈自体が不安定なので n>=8 のときだけ出す
        if (entry.n < 8) return null;
        const blowRate = entry.blow / entry.n;
        let text: string | null = null;
        if (blowRate >= 0.4) {
          text = neutral
            ? "読み方: ミスの中央値は同水準帯なみですが、大きく崩れるレースの割合が高め＝平均型というより「ムラ型」の出方です（参考）"
            : better
              ? "読み方: ふだんのミスは少なめですが、崩れるときは大きい傾向です（参考）"
              : "読み方: ミスが多めで、大崩れの頻度も高めです（参考）";
        } else if (blowRate <= 0.15) {
          text = "読み方: 大崩れの少ない安定した出方です（参考）";
        }
        return text ? <p className="mt-1 text-xs text-muted">{text}</p> : null;
      })()}
    </div>
  );
}

/**
 * クロスレース分析カード（方法論プラン層A・Stage 1）。
 * ビルド時に lc_performances 全体から生成した cross-race.json（種目別 Theil–Sen 回帰）を参照する。
 * アーティファクト不在・スケルトン・未掲載選手（n<5）は何も描画しない。
 */
export function CrossRaceCard({ name }: { name: string }) {
  const [index, setIndex] = useState<CrossRaceIndex | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCrossRace().then((idx) => {
      if (!cancelled) setIndex(idx);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const athlete = index?.athletes[name];
  if (!index || !athlete) return null;
  const forest = athlete.f && index.disciplines.forest;
  const sprint = athlete.s && index.disciplines.sprint;
  if (!forest && !sprint) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold">クロスレース分析 — ミス率の相対評価</h3>
        <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[9px] font-medium text-[#00e5ff]">
          β
        </span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {forest && athlete.f && (
          <DisciplineRow
            label="フォレスト"
            entry={athlete.f}
            fitAthletes={forest.athletes}
            q3Miss={forest.q3Miss}
          />
        )}
        {sprint && athlete.s && (
          <DisciplineRow
            label="スプリント"
            entry={athlete.s}
            fitAthletes={sprint.athletes}
            q3Miss={sprint.q3Miss}
          />
        )}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-muted">
        期待値＝同じ巡航速度指標の選手が平均的に出すミス率（LapCenter 取込5レース以上の選手が対象・数値は
        LapCenter 算出値の集計）。「巡航速度指標」は出走クラス相対の値で、絶対走力の比較ではありません。
        <a href="/docs/analysis-system#cross-race" className="underline hover:text-foreground">算出方法の詳細</a>
      </p>
    </div>
  );
}
