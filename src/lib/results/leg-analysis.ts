// 結果分析「レッグカード」ビューのビューモデル生成（純関数・relay-first）。
// LapCenter の per-leg relay 値（legLossTime=ミス, legSpeed, lapRank, Ave3）をそのまま使い、
// 表示に必要な形へ整形するだけ。再計算（median polish / EM 等）はしない。
// docs/plans/2026-06-29_results-analysis-methodology.md §8.1 準拠。
//
// メトリクス方向の罠: legSpeed/speed は小さいほど速い＝良い。legLossTime は小さい・負ほど良い。

import {
  type LapCenterRunnerDetail,
  lapStrToSeconds,
  deriveAve3Seconds,
} from "../scraper/lapcenter-detail";
import type { LapCenterPerformance } from "../analysis/types";

export interface LegCell {
  label: string;            // "S→1", "12→13", "22→F"
  lap: string;              // 表示用スプリット "10:26"
  lapSec: number | null;
  ave3Sec: number | null;   // レッグ基準（上位3平均）
  ave3Str: string;          // "8:00"
  lossSec: number;          // 符号付き秒（正=ロス/ミス、負=基準より速い）
  lossStr: string;          // 表示 "+2:01" / "-0:04" / "0:00"
  lapRank: number | null;   // そのレッグの区間順位
  legSpeed: number | null;  // 相対ペース（100=Ave3, 小さいほど速い）
  isTopMiss: boolean;       // ロス上位3レッグ
}

export interface LegViewSubject {
  name: string;
  club: string;
  rank: number | null;
  result: string;
  resultSec: number | null;
  speed: number | null;
  lossRate: number | null;
  idealTime: string;
  idealSec: number | null;
  totalLossTime: string;
}

/**
 * 自分の同種目（Forest / Sprint）平均との比較。Forest と Sprint は混ぜない。
 * delta が負＝自分の平均より良い（速い / ミス少）。履歴が無ければ各値 null。
 */
export interface SelfComparison {
  discipline: "forest" | "sprint" | null;
  avgSpeed: number | null;      // 自分の同種目平均 巡航速度
  avgLossRate: number | null;   // 自分の同種目平均 ミス率
  speedDelta: number | null;    // このレース − 自分平均（負＝平均より速い＝良い）
  lossRateDelta: number | null; // このレース − 自分平均（負＝平均よりミス少＝良い）
  sampleSize: number;           // 平均の母数（現レースを除く同種目レース数）
}

export interface LegView {
  subject: LegViewSubject;
  n: number;                // 完走者数（rank 付き）
  legCount: number;
  legs: LegCell[];
  idealRank: number | null; // ノーミスなら推定◯位（idealTime を他者の実記録と比較）
  topMistakes: { index: number; label: string; lossSec: number; lossStr: string }[];
  self: SelfComparison;     // 自分の同種目平均との比較（種目別）
  cumulativeLoss: number[]; // 各CP時点の累積ロス秒（積み上げカーブ用・legs と同順）
}

/** 自分の同種目平均との比較を算出。history は選手の LC 全履歴、discipline は現レースの種目。 */
function buildSelfComparison(
  subject: LapCenterRunnerDetail,
  self: { discipline: "forest" | "sprint"; history: LapCenterPerformance[]; excludeDate?: string } | undefined,
): SelfComparison {
  if (!self) {
    return { discipline: null, avgSpeed: null, avgLossRate: null, speedDelta: null, lossRateDelta: null, sampleSize: 0 };
  }
  // 同種目のみ・現レース（同日）は基準から除外して自己ベースラインの自己汚染を防ぐ
  const sameDisc = self.history.filter(
    (h) => h.t === self.discipline && (!self.excludeDate || h.d !== self.excludeDate),
  );
  const speeds = sameDisc.map((h) => h.s).filter((v) => Number.isFinite(v));
  const misses = sameDisc.map((h) => h.m).filter((v) => Number.isFinite(v));
  const avgS = mean(speeds);
  const avgM = mean(misses);
  return {
    discipline: self.discipline,
    avgSpeed: round1(avgS),
    avgLossRate: round1(avgM),
    speedDelta: avgS != null && subject.speed != null ? round1(subject.speed - avgS) : null,
    lossRateDelta: avgM != null && subject.lossRate != null ? round1(subject.lossRate - avgM) : null,
    sampleSize: sameDisc.length,
  };
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round1(x: number | null): number | null {
  return x == null ? null : Math.round(x * 10) / 10;
}

/** "S→1" / "i→i+1" / "(L-1)→F" のレッグ表記。 */
export function legLabel(index: number, legCount: number): string {
  if (index === 0) return "S→1";
  if (index === legCount - 1) return `${legCount - 1}→F`;
  return `${index}→${index + 1}`;
}

/** 符号付き秒を "m:ss"（先頭符号つき）で表示。0 は "0:00"。 */
export function fmtSignedSeconds(sec: number | null): string {
  if (sec == null) return "—";
  const sign = sec > 0 ? "+" : sec < 0 ? "-" : "";
  const a = Math.abs(Math.round(sec));
  const m = Math.floor(a / 60);
  const s = a % 60;
  return `${sign}${m}:${String(s).padStart(2, "0")}`;
}

/** 各レッグの基準 Ave3（秒）。フィールド各走者からの逆算値の中央値（rounding に頑健）。 */
export function deriveAve3PerLeg(runners: LapCenterRunnerDetail[], legCount: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let l = 0; l < legCount; l++) {
    const est = runners
      .map((r) => deriveAve3Seconds(r.lapTime[l] ?? "", r.legSpeed[l] ?? null))
      .filter((v): v is number => v != null && Number.isFinite(v))
      .sort((a, b) => a - b);
    out.push(est.length ? est[Math.floor(est.length / 2)] : null);
  }
  return out;
}

/** 名前マッチ用の正規化（空白除去）。クライアントと共有して二重定義を防ぐ（レビュー H）。
 *  ※全角半角/大小文字の吸収は lc_performances の name 同期元統一が前提のため別途（レビュー P・人間判断）。 */
export function normalizeName(s: string): string {
  return s.replace(/\s+/g, "");
}

/**
 * ビューモデル生成。subjectName 未指定なら優勝者（rank=1, 無ければ先頭）を主役にする。
 * self を渡すと「自分の同種目平均との差」（Forest/Sprint 別）を併記できる。
 */
export function buildLegView(
  runners: LapCenterRunnerDetail[],
  subjectName?: string,
  self?: { discipline: "forest" | "sprint"; history: LapCenterPerformance[]; excludeDate?: string },
): LegView | null {
  if (runners.length === 0) return null;

  const finishers = runners.filter((r) => r.rank != null);
  const n = finishers.length;

  let subject: LapCenterRunnerDetail | undefined;
  if (subjectName) {
    const key = normalizeName(subjectName);
    subject = runners.find((r) => normalizeName(r.name) === key);
  }
  if (!subject) {
    subject = finishers.find((r) => r.rank === 1) ?? finishers[0] ?? runners[0];
  }
  if (!subject) return null;

  const legCount = subject.lapTime.length;
  // relay-first 健全性: 主役の per-leg 配列長が相互不整合なら黙って穴埋めせず描画しない（fail-fast・レビュー C）
  if (
    [subject.lapRank, subject.elapsedTime, subject.elapsedRank, subject.legLossTime, subject.legSpeed].some(
      (a) => a.length !== legCount,
    )
  ) {
    console.warn(`[leg-analysis] inconsistent per-leg array lengths for "${subject.name}" — skipping view`);
    return null;
  }
  const ave3 = deriveAve3PerLeg(runners, legCount);

  const losses = subject.legLossTime.map((t) => lapStrToSeconds(t) ?? 0);
  const topMistakes = losses
    .map((lossSec, index) => ({ index, lossSec }))
    .filter((x) => x.lossSec > 0)
    .sort((a, b) => b.lossSec - a.lossSec)
    .slice(0, 3)
    .map((x) => ({
      index: x.index,
      label: legLabel(x.index, legCount),
      lossSec: x.lossSec,
      lossStr: fmtSignedSeconds(x.lossSec),
    }));
  const topMissSet = new Set(topMistakes.map((x) => x.index));

  const legs: LegCell[] = subject.lapTime.map((lap, i) => {
    const lossSec = losses[i] ?? 0;
    return {
      label: legLabel(i, legCount),
      lap,
      lapSec: lapStrToSeconds(lap),
      ave3Sec: ave3[i],
      ave3Str: ave3[i] != null ? fmtSignedSeconds(ave3[i]).replace(/^\+/, "") : "—",
      lossSec,
      lossStr: fmtSignedSeconds(lossSec),
      lapRank: subject.lapRank[i] ?? null,
      legSpeed: subject.legSpeed[i] ?? null,
      isTopMiss: topMissSet.has(i),
    };
  });

  // 累積ロス（各CP時点での legLossTime の符号付き累計）— 積み上げカーブ用
  const cumulativeLoss: number[] = [];
  {
    let acc = 0;
    for (const leg of legs) {
      acc += leg.lossSec;
      cumulativeLoss.push(acc);
    }
  }

  const idealSec = lapStrToSeconds(subject.idealTime);
  const idealRank =
    idealSec == null
      ? null
      : 1 + finishers.filter((r) => (lapStrToSeconds(r.result) ?? Infinity) < idealSec).length;

  return {
    subject: {
      name: subject.name,
      club: subject.club,
      rank: subject.rank,
      result: subject.result,
      resultSec: lapStrToSeconds(subject.result),
      speed: subject.speed,
      lossRate: subject.lossRate,
      idealTime: subject.idealTime,
      idealSec,
      totalLossTime: subject.totalLossTime,
    },
    n,
    legCount,
    legs,
    idealRank,
    topMistakes,
    self: buildSelfComparison(subject, self),
    cumulativeLoss,
  };
}
