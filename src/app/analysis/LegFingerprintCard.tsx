"use client";

import { useEffect, useState } from "react";
import type { LegFingerprintIndex, DisciplineFingerprint } from "@/lib/analysis/leg-fingerprint";

// artifact は全選手共通なのでセッション中1回だけ fetch（LapCenterChart の重みとも共用）
let fpPromise: Promise<LegFingerprintIndex | null> | null = null;
export function loadLegFingerprint(): Promise<LegFingerprintIndex | null> {
  fpPromise ??= fetch("/data/leg-fingerprint.json")
    .then((r) => (r.ok ? (r.json() as Promise<LegFingerprintIndex>) : null))
    .then((idx) => (idx && idx.generatedAt ? idx : null))
    .catch(() => null);
  return fpPromise;
}

const PHASE_LABELS = ["序盤", "中盤", "終盤"];
const LEN_LABELS = ["短", "中", "長"];

function DisciplineBlock({
  label,
  fp,
  sevLabels,
}: {
  label: string;
  fp: DisciplineFingerprint;
  sevLabels: [string, string, string];
}) {
  const base = fp.missRate;
  const sevMax = Math.max(...fp.sev, 1);
  return (
    <div className="rounded-lg bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-[10px] text-muted">
          {fp.racesUsed}レース / {fp.legsValid}レッグ / 全体ミス率 {(base * 100).toFixed(0)}%
        </p>
      </div>

      {/* 3×3 グリッド（行=局面・列=レッグ長） */}
      <div className="mt-2 grid grid-cols-[auto_repeat(3,1fr)] gap-1 text-center text-[10px]">
        <span />
        {LEN_LABELS.map((l) => (
          <span key={l} className="text-muted">
            {l}レッグ
          </span>
        ))}
        {PHASE_LABELS.map((phase, p) => (
          <div key={phase} className="contents">
            <span className="pr-1 text-right leading-6 text-muted">{phase}</span>
            {LEN_LABELS.map((_, len) => {
              const c = fp.cells[p * 3 + len];
              const rate = c.n > 0 ? c.m / c.n : null;
              return (
                <div
                  key={len}
                  className={`rounded px-1 py-1 leading-none ${
                    c.flag ? "bg-red-500/25 font-bold text-red-200" : "bg-white/5 text-foreground/85"
                  }`}
                  title={`n=${c.n} ミス${c.m}`}
                >
                  {rate == null || c.n < 5 ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <>
                      {(rate * 100).toFixed(0)}%
                      <span className="ml-0.5 text-[8px] font-normal text-muted">({c.n})</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* 重大度ヒストグラム */}
      <div className="mt-2 space-y-0.5">
        {fp.sev.map((count, i) => (
          <div key={i} className="flex items-center gap-2 text-[10px]">
            <span className="w-20 flex-shrink-0 text-muted">{sevLabels[i]}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-primary/50" style={{ width: `${(count / sevMax) * 100}%` }} />
            </div>
            <span className="w-8 flex-shrink-0 text-right font-mono tabular-nums">{count}</span>
          </div>
        ))}
      </div>

      {/* lag-1（ゲート通過時のみ） */}
      {fp.lag1 && (
        <p className="mt-2 text-[10px] text-muted">
          ミスの直後のレッグもミスになりやすい傾向
          <span className="font-mono font-bold text-foreground/85">（約{fp.lag1.rr.toFixed(1)}倍・レース内比較・参考）</span>
        </p>
      )}

      {(fp.legsPack > 0 || fp.packUnchecked > 0) && (
        <p className="mt-1.5 text-[9px] text-muted/70">
          {fp.legsPack > 0 ? `集団走の疑い ${fp.legsPack} レッグを除外。` : ""}
          {fp.packUnchecked > 0 ? `スタート時刻不明で未チェック ${fp.packUnchecked} レース。` : ""}
        </p>
      )}
    </div>
  );
}

/**
 * クロスレース「ミスの傾向」カード（方法論プラン層A・Stage 2b）。
 * ビルド時に lc_leg_splits 全体から生成した leg-fingerprint.json を参照。
 * 未掲載選手（種目ゲート未達）は非表示。
 */
export function LegFingerprintCard({ name }: { name: string }) {
  const [index, setIndex] = useState<LegFingerprintIndex | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLegFingerprint().then((idx) => {
      if (!cancelled) setIndex(idx);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const athlete = index?.athletes[name];
  if (!index || !athlete || (!athlete.f && !athlete.s)) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold">ミスの傾向（クロスレース）</h3>
        <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[9px] font-medium text-[#00e5ff]">β</span>
      </div>
      <p className="mt-1 text-xs text-foreground/80">
        どの局面・どの長さのレッグでミスが出やすいか。赤いセルは自分の平均より統計的に偏って多い場所。
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {athlete.f && (
          <DisciplineBlock label="フォレスト" fp={athlete.f} sevLabels={["小 (10-30s)", "中 (30-90s)", "大 (90s+)"]} />
        )}
        {athlete.s && (
          <DisciplineBlock label="スプリント" fp={athlete.s} sevLabels={["小 (5-15s)", "中 (15-45s)", "大 (45s+)"]} />
        )}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-muted">
        「ミス」＝LapCenter のレッグ別ロス（自分の巡航ペース基準の残差）が想定タイムの30%以上（フォレスト10秒/スプリント5秒未満は除外）
        となったレッグの規約判定で、ナビミスそのものではありません（パック・地形・コンディション・慎重な安全ルートのロスも含まれえます。
        「もっと攻めるべき」という意味ではありません）。
        赤フラグはレース内のミス総数を固定した並べ替え検定（レース内相関・日次調子を保存）＋BH-FDR（q=0.10・9セル）＋効果量ゲートによる判定で、
        フラグの1割程度は偶然でも生じえます。レッグ長はレース内相対（短/中/長はそのレース内の三分位）。
        集団走の疑いレッグ（前後の通過時刻が別走者と連続近接）は集計から除外していますが、検出は完全ではなく、
        除外自体も無作為ではありません（除外数を上に表示）。リレー系クラスは対象外。同姓同名は合算されうる。
      </p>
    </div>
  );
}
