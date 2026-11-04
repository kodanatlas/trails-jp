/**
 * 補正済みポイント（選手ヘッダーのメイン数値）の計算。ビルド（build-analysis-index）と
 * 選手ページ表示（AthleteDetail）で同じ関数を使い、内訳とメイン数値を一致させる。
 *
 * 1. 大会プール: 性別に応じた無差別クラスの、JOY と同じ窓（ランキング日の1年前以降）の
 *    日付付き実大会のみ。日付なしの「補完」行・窓外の古い大会は使わない。
 * 2. スプリント水準差 gap: 両種目とも窓内3大会以上の選手について、同一選手の
 *    「S 上位3平均 − F 上位3平均」を出し、水準（性別内パーセンタイル）で4層に分けた
 *    各層の中央値を節点にする。差は水準が高いほど小さいため定数ではなく区分線形。
 *    節点は男女共通（パーセンタイルは性別ごとに付ける）。男女別の中央値は共通値と有意に違わず、
 *    女子の層は人数が少なく不安定なため（2026-11 検証、計画書参照）。
 * 3. 各選手の gap は、推定と同じ物差し（両種目の上位3平均の平均）の性別内パーセンタイルで
 *    節点を補間する。両種目とも3大会以上ない選手は、S 上位3平均のパーセンタイルで代用する。
 *    （S 水準だけで層を切るとスプリント得意な選手ほど差が大きく見え、得意さまで差し引いてしまう）
 * 4. スプリント各大会から gap を引き、フォレストと混在で上位3大会を合計。
 *    実大会が3未満のときだけ、JOY と同じく「補完」値を1枠だけ足す（実大会を押しのけない）。
 *
 * 経緯: docs/plans/2026-11-04_sprint-gap-recalibration.md
 */

export type Discipline = "forest" | "sprint";

export interface ScoreEvent {
  date: string; // YYYY-MM-DD（補完行は空）
  eventName: string;
  points: number;
}

export interface GapNode {
  pct: number; // 性別内パーセンタイル（0=トップ）
  gap: number; // 1大会あたりの差し引き量
}

export interface SprintGapModel {
  /** 男女共通の節点（水準は性別内パーセンタイル） */
  nodes: GapNode[];
  pairedCount: number;
  /** 性別ごとのペア選手の S 上位3平均（降順）。両種目そろわない選手の水準→パーセンタイル変換用 */
  sprintLevels: { male: number[]; female: number[] };
  /** 性別ごとのペア選手の「両種目の上位3平均の平均」（降順）。ペア選手の水準→パーセンタイル変換用 */
  combinedLevels: { male: number[]; female: number[] };
}

export interface PairedAthleteInput {
  female: boolean;
  forest: number[]; // 窓内の実大会得点
  sprint: number[];
}

/** 層の境界（性別内パーセンタイル）。節点は各層の中点に置く */
const TIER_BOUNDS = [0, 0.1, 0.25, 0.5, 1];
export const MIN_EVENTS_FOR_PAIR = 3;
const MIN_PAIRED_TOTAL = 30;
const MIN_TIER_COUNT = 8;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" の1年前の同日（2/29 は 2/28） */
export function oneYearBefore(date: string): string {
  const [y, m, d] = date.split("-");
  const day = m === "02" && d === "29" ? "28" : d;
  return `${Number(y) - 1}-${m}-${day}`;
}

/** 補正済みポイントの対象にする大会だけを残す（日付付き・窓内・正の得点・同一大会は1件） */
export function poolEvents(events: readonly ScoreEvent[], windowStart: string): ScoreEvent[] {
  const byKey = new Map<string, ScoreEvent>();
  for (const e of events) {
    if (!DATE_RE.test(e.date) || e.date < windowStart || !(e.points > 0)) continue;
    const key = `${e.date}\u0000${e.eventName}`;
    const prev = byKey.get(key);
    if (!prev || e.points > prev.points) byKey.set(key, e);
  }
  return [...byKey.values()];
}

/** JOY の「補完」行（日付なし・大会名が補完で始まる）の得点。無ければ null */
export function fillPoint(events: readonly ScoreEvent[]): number | null {
  const fills = events.filter((e) => !DATE_RE.test(e.date) && e.eventName.startsWith("補完") && e.points > 0);
  return fills.length === 0 ? null : Math.max(...fills.map((e) => e.points));
}

export function top3Average(points: readonly number[]): number | null {
  if (points.length === 0) return null;
  const top = [...points].sort((a, b) => b - a).slice(0, 3);
  return top.reduce((s, v) => s + v, 0) / top.length;
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 節点を区分線形で補間（範囲外は端の値） */
export function gapAt(pct: number, nodes: readonly GapNode[]): number {
  if (nodes.length === 0) return 0;
  if (pct <= nodes[0].pct) return nodes[0].gap;
  const last = nodes[nodes.length - 1];
  if (pct >= last.pct) return last.gap;
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const b = nodes[i];
    if (pct <= b.pct) return a.gap + ((pct - a.pct) / (b.pct - a.pct)) * (b.gap - a.gap);
  }
  return last.gap;
}

/** 降順の参照分布の中での位置（0=トップ、1=最下位）。同値は半分ずつ数える */
export function levelPercentile(level: number, refDesc: readonly number[]): number {
  if (refDesc.length === 0) return 0.5;
  let above = 0;
  let equal = 0;
  for (const v of refDesc) {
    if (v > level) above++;
    else if (v === level) equal++;
  }
  return (above + equal / 2) / refDesc.length;
}

/** 降順に並べたときの各要素のパーセンタイル（0=トップ） */
function rankPercentiles(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const out = new Array<number>(values.length);
  order.forEach((o, rank) => {
    out[o.i] = values.length === 1 ? 0 : rank / (values.length - 1);
  });
  return out;
}

/**
 * ペア選手（両種目とも窓内3大会以上）から水準別の gap 節点を推定する。
 * 層分けの水準は「S 上位3平均と F 上位3平均の平均」（片方だけで分けると差そのものに回帰効果が乗る）。
 * パーセンタイルは性別ごとに付け、層は男女をまとめて中央値を取る。
 */
export function estimateSprintGapModel(athletes: readonly PairedAthleteInput[]): SprintGapModel | null {
  const paired = athletes
    .filter((a) => a.forest.length >= MIN_EVENTS_FOR_PAIR && a.sprint.length >= MIN_EVENTS_FOR_PAIR)
    .map((a) => {
      const f3 = top3Average(a.forest)!;
      const s3 = top3Average(a.sprint)!;
      return { female: a.female, f3, s3, d: s3 - f3, level: (s3 + f3) / 2 };
    });
  if (paired.length < MIN_PAIRED_TOTAL) return null;

  const withPct: { pct: number; d: number }[] = [];
  for (const female of [false, true]) {
    const group = paired.filter((p) => p.female === female);
    const pcts = rankPercentiles(group.map((p) => p.level));
    group.forEach((p, i) => withPct.push({ pct: pcts[i], d: p.d }));
  }

  const nodes: GapNode[] = [];
  for (let t = 0; t < TIER_BOUNDS.length - 1; t++) {
    const lo = TIER_BOUNDS[t];
    const hi = TIER_BOUNDS[t + 1];
    const last = t === TIER_BOUNDS.length - 2;
    const inTier = withPct.filter((x) => x.pct >= lo && (last ? x.pct <= hi : x.pct < hi));
    // 層が1つでも欠けると補正の形が変わるため、モデルを作らない（呼び出し側でビルドを止める）
    if (inTier.length < MIN_TIER_COUNT) return null;
    nodes.push({ pct: (lo + hi) / 2, gap: Math.round(median(inTier.map((x) => x.d)) * 10) / 10 });
  }

  const levels = (female: boolean, pick: (p: (typeof paired)[number]) => number) =>
    paired.filter((p) => p.female === female).map(pick).sort((a, b) => b - a);
  return {
    nodes,
    pairedCount: paired.length,
    sprintLevels: { male: levels(false, (p) => p.s3), female: levels(true, (p) => p.s3) },
    combinedLevels: { male: levels(false, (p) => p.level), female: levels(true, (p) => p.level) },
  };
}

/**
 * 選手の1大会あたりの差し引き量。forest/sprint は窓内の実大会得点。
 * 両種目とも3大会以上なら両種目平均の水準、そうでなければ S 水準でパーセンタイルを取る。
 * スプリントの大会が無ければ null。
 */
export function sprintGapFor(
  female: boolean,
  forest: readonly number[],
  sprint: readonly number[],
  model: SprintGapModel,
): number | null {
  const s3 = top3Average(sprint);
  if (s3 == null) return null;
  const pairedLike = forest.length >= MIN_EVENTS_FOR_PAIR && sprint.length >= MIN_EVENTS_FOR_PAIR;
  const pct = pairedLike
    ? levelPercentile((s3 + top3Average(forest)!) / 2, female ? model.combinedLevels.female : model.combinedLevels.male)
    : levelPercentile(s3, female ? model.sprintLevels.female : model.sprintLevels.male);
  return Math.round(gapAt(pct, model.nodes) * 10) / 10;
}

/**
 * JOY の合計点（窓内の実大会の上位3＋実大会が3未満なら補完1枠）を最もよく再現する窓の開始日を推定する。
 * ビルド日ではなくデータ自身から決めるので、取得に失敗して古い JSON が残っても窓がずれない。
 * 候補は各大会日（その日を含む）。一致率が最大の候補のうち最も早い日を返す。
 */
export function inferWindowStart(
  entries: readonly { total: number; events: readonly ScoreEvent[] }[],
  tolerance = 2,
): { windowStart: string; matchRate: number } | null {
  const dated = entries.map((e) => ({
    total: e.total,
    real: e.events.filter((x) => DATE_RE.test(x.date) && x.points > 0),
    fill: fillPoint(e.events),
  }));
  const dates = [...new Set(dated.flatMap((e) => e.real.map((x) => x.date)))].sort();
  if (dates.length === 0 || dated.length === 0) return null;
  let best: { windowStart: string; matches: number } | null = null;
  for (const start of dates) {
    let matches = 0;
    for (const e of dated) {
      const pts = e.real.filter((x) => x.date >= start).map((x) => x.points).sort((a, b) => b - a).slice(0, 3);
      if (pts.length < 3 && e.fill != null) pts.push(e.fill);
      const sum = pts.sort((a, b) => b - a).slice(0, 3).reduce((s, v) => s + v, 0);
      if (Math.abs(sum - e.total) <= tolerance) matches++;
    }
    if (!best || matches > best.matches) best = { windowStart: start, matches };
  }
  return best ? { windowStart: best.windowStart, matchRate: best.matches / dated.length } : null;
}

export interface AdjustedEvent extends ScoreEvent {
  discipline: Discipline;
  corrected: number;
}

/**
 * スプリント各大会から gap を引き、フォレストと混在で上位3大会を合計（入力はプール済みの大会）。
 * 実大会が3未満なら、両種目の補完値（スプリントは gap 差引後）の高い方を1枠だけ足す（JOY と同じ扱い）。
 */
export function computeAdjustedTop3(
  forest: readonly ScoreEvent[],
  sprint: readonly ScoreEvent[],
  sprintGap: number,
  fills: { forest: number | null; sprint: number | null } = { forest: null, sprint: null },
): { total: number | null; top3: AdjustedEvent[] } {
  const all: AdjustedEvent[] = [
    ...forest.map((e) => ({ ...e, discipline: "forest" as const, corrected: e.points })),
    ...sprint.map((e) => ({ ...e, discipline: "sprint" as const, corrected: e.points - sprintGap })),
  ];
  if (all.length > 0 && all.length < 3) {
    const cands: AdjustedEvent[] = [];
    if (fills.forest != null && forest.length > 0) {
      cands.push({ date: "", eventName: "補完（大会数3未満の枠埋め・JOYと同じ）", points: fills.forest, discipline: "forest", corrected: fills.forest });
    }
    if (fills.sprint != null && sprint.length > 0) {
      cands.push({ date: "", eventName: "補完（大会数3未満の枠埋め・JOYと同じ）", points: fills.sprint, discipline: "sprint", corrected: fills.sprint - sprintGap });
    }
    cands.sort((a, b) => b.corrected - a.corrected);
    if (cands[0]) all.push(cands[0]);
  }
  all.sort((a, b) => b.corrected - a.corrected);
  const top3 = all.slice(0, 3);
  if (top3.length === 0) return { total: null, top3 };
  const total = Math.round(top3.reduce((s, e) => s + e.corrected, 0) * 10) / 10;
  return { total, top3 };
}
