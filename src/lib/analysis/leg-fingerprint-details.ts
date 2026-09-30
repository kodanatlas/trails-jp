/**
 * ミスの傾向（クロスレース）の明細＝各セルの割合の根拠レッグ。
 * docs/plans/2026-09-30_miss-trend-drilldown.md
 *
 * 明細は buildLegFingerprintArtifacts が集計と同じループから書き出す。
 * verifyFingerprintDetails は明細から集計を数え直し、カードの数字（index）と1件でも
 * 食い違えば FingerprintInvariantError を投げる（ビルドを落とし、本番は前回成功デプロイのまま）。
 */
import {
  classifyMiss,
  type CompanionRow,
  type DisciplineFingerprint,
  type FingerprintParams,
  type LegFingerprintIndex,
  type PeriodStat,
  type TrackedLegRow,
} from "./leg-fingerprint";

/** 明細のレース。x=集計に採用しなかった理由（無ければ採用）・pu=スタート時刻不明で集団走を未チェック */
export interface DetailRace {
  d: string;          // 日付
  e: string;          // 大会名
  c: string | null;   // クラス
  ev: number;         // LapCenter 大会 ID
  cl: number;         // LapCenter クラス ID
  ri: number | null;  // クラス内の走者番号（同クラスの再走を区別する）
  L: number;          // レッグ数
  x?: "pack" | "clean";
  pu?: 1;
}

/**
 * 集計に使ったレッグ（列指向）。r=races の添字・l=レッグ番号(0始まり)・c=セル(局面*3+レッグ長)・m=ミス判定・
 * fm=本人を除く同じクラスの完走者の想定との差の中央値（相手なしは null）・fn=その人数（難レッグ判定用。
 * docs/plans/2026-09-30_miss-trend-field-comparison.md）
 */
export interface DetailLegs {
  r: number[];
  l: number[];
  c: number[];
  lap: number[];
  loss: number[];
  m: (0 | 1)[];
  fm: (number | null)[];
  fn: number[];
}

export interface DisciplineDetail {
  races: DetailRace[];
  legs: DetailLegs;
  /** 集団走の疑いで除外したレッグ（採用・不採用レースとも） */
  pack: { r: number[]; l: number[] };
}

export interface AthleteDetail {
  f?: DisciplineDetail;
  s?: DisciplineDetail;
}

export type FingerprintDetails = Record<string, AthleteDetail>;

/** 配信する選手別ファイルの中身。gen が leg-fingerprint.json の gen と一致するときだけ UI は表示する */
export interface AthleteDetailShard extends AthleteDetail {
  gen: string;
}

/** 選手別ファイルの置き場所（public/data 配下のディレクトリ名） */
export const LEG_FP_DIR = "leg-fp";

/** generatedAt（ISO）から世代番号を作る: 2026-09-30T10:48:02.219Z → 20260930T104802219Z */
export function fingerprintGen(generatedAt: string): string {
  return generatedAt.replace(/[-:.]/g, "");
}

/** 選手キーをそのままファイル名にしてよいか（パス区切り・隠しファイル・空を弾く） */
export function isSafeShardKey(key: string): boolean {
  return key.length > 0 && !/[/\\\0]/.test(key) && !key.startsWith(".");
}

/** 選手別ファイルの URL */
export function legFpShardUrl(gen: string, key: string): string {
  return `/data/${LEG_FP_DIR}/${gen}/${encodeURIComponent(key)}.json`;
}

export class FingerprintInvariantError extends Error {
  constructor(message: string) {
    super(`leg-fingerprint 明細の不変条件違反: ${message}`);
    this.name = "FingerprintInvariantError";
  }
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

function fail(who: string, message: string): never {
  throw new FingerprintInvariantError(`${who}: ${message}`);
}

function expectEqual(who: string, label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(who, `${label} が一致しない（明細 ${JSON.stringify(actual)} / 集計 ${JSON.stringify(expected)}）`);
  }
}

/** レース単位の件数（採用数・未チェック数・集団走除外）を照合 */
function verifyRaces(who: string, fp: DisciplineFingerprint, d: DisciplineDetail): void {
  expectEqual(who, "races", d.races.length, fp.races);
  expectEqual(who, "racesUsed", d.races.filter((r) => r.x == null).length, fp.racesUsed);
  expectEqual(who, "packUnchecked", d.races.filter((r) => r.pu === 1).length, fp.packUnchecked);
  if (d.pack.r.length !== d.pack.l.length) fail(who, "pack 列の長さが不揃い");
  expectEqual(who, "legsPack", d.pack.r.length, fp.legsPack);
  d.pack.r.forEach((r, i) => {
    const race = d.races[r];
    if (!race || !(d.pack.l[i] >= 0 && d.pack.l[i] < race.L)) fail(who, `pack[${i}] が範囲外`);
  });
}

/** レッグ1本ずつの整合（参照先・番号・局面・ミス判定の再計算・重複なし） */
function verifyLegs(who: string, d: DisciplineDetail, floor: number, ratio: number): void {
  const { r, l, c, lap, loss, m, fm, fn } = d.legs;
  const n = r.length;
  if ([l, c, lap, loss, m, fm, fn].some((col) => col.length !== n)) fail(who, "legs 列の長さが不揃い");
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const race = d.races[r[i]];
    if (!race || race.x != null) fail(who, `legs[${i}] が採用レースを指していない`);
    if (!Number.isInteger(l[i]) || l[i] < 0 || l[i] >= race.L) fail(who, `legs[${i}] のレッグ番号が範囲外`);
    if (!Number.isInteger(c[i]) || c[i] < 0 || c[i] > 8) fail(who, `legs[${i}] のセル番号が範囲外`);
    if (Math.floor(c[i] / 3) !== Math.min(2, Math.floor((3 * l[i]) / race.L))) {
      fail(who, `legs[${i}] の局面とセルが矛盾`);
    }
    if (m[i] !== (classifyMiss(lap[i], loss[i], floor, ratio) ? 1 : 0)) fail(who, `legs[${i}] のミス判定が再計算と不一致`);
    if (!Number.isInteger(fn[i]) || fn[i] < 0 || (fn[i] === 0) !== (fm[i] == null)) {
      fail(who, `legs[${i}] のフィールド中央値と人数が矛盾`);
    }
    const k = `${r[i]}:${l[i]}`;
    if (seen.has(k)) fail(who, `legs[${i}] が重複`);
    seen.add(k);
  }
}

/** 期間別（直近/それ以前）を明細から数え直し、表示ゲートの判定（出る/出ない）まで照合 */
function verifyPeriods(
  who: string,
  fp: DisciplineFingerprint,
  d: DisciplineDetail,
  P: FingerprintParams,
  periodCutoff: string | undefined
): void {
  if (!periodCutoff) {
    if (fp.periods) fail(who, "期間の境界が無いのに periods がある");
    return;
  }
  const { r, m } = d.legs;
  const stat = (pred: (date: string) => boolean): PeriodStat => {
    const used = new Set<number>();
    let n = 0;
    let mm = 0;
    r.forEach((ri, i) => {
      if (!pred(d.races[ri].d)) return;
      used.add(ri);
      n++;
      mm += m[i];
    });
    return { races: used.size, n, m: mm };
  };
  const recent = stat((x) => x >= periodCutoff);
  const older = stat((x) => x < periodCutoff);
  const ok = (s: PeriodStat) => s.races >= P.periodMinRaces && s.n >= P.periodMinLegs;
  expectEqual(who, "periods", fp.periods ?? null, ok(recent) && ok(older) ? { recent, older } : null);
}

/** 明細から集計値（セル・ミス率・規模別）を数え直して照合 */
function verifyAggregates(
  who: string,
  fp: DisciplineFingerprint,
  d: DisciplineDetail,
  sevBins: [number, number]
): void {
  const { r, c, loss, m } = d.legs;
  expectEqual(who, "legsValid", r.length, fp.legsValid);
  const cells = Array.from({ length: 9 }, () => ({ n: 0, m: 0 }));
  const sev: [number, number, number] = [0, 0, 0];
  let missTotal = 0;
  for (let i = 0; i < r.length; i++) {
    cells[c[i]].n++;
    if (m[i] !== 1) continue;
    cells[c[i]].m++;
    missTotal++;
    sev[loss[i] < sevBins[0] ? 0 : loss[i] < sevBins[1] ? 1 : 2]++;
  }
  expectEqual(who, "cells", cells, fp.cells.map((x) => ({ n: x.n, m: x.m })));
  expectEqual(who, "sev", sev, fp.sev);
  expectEqual(who, "missRate", r.length > 0 ? round3(missTotal / r.length) : null, fp.missRate);
}

function verifyDiscipline(
  who: string,
  fp: DisciplineFingerprint,
  d: DisciplineDetail,
  disc: "f" | "s",
  P: FingerprintParams,
  periodCutoff: string | undefined
): void {
  const kind = disc === "f" ? "forest" : "sprint";
  verifyRaces(who, fp, d);
  verifyLegs(who, d, P.floors[kind], P.missRatio);
  verifyAggregates(who, fp, d, P.sevBins[kind]);
  verifyPeriods(who, fp, d, P, periodCutoff);
}

// ---- 元データ（lc_leg_splits の tracked 行）との突き合わせ ----
// 集計と明細が同じ配線バグを共有すると verifyFingerprintDetails は素通りする（Codex レビュー 2026-09-30）。
// ここでは明細の各行が「どの出走行のどのレッグか」を元データから独立に確かめる。

const sourceKey = (name: string, ev: number, cl: number, ri: number | null) => `${name}|${ev}|${cl}|${ri}`;

/** レッグ長の区分（0短/1中/2長）を元データから独立に計算する（有効レッグの Ave3 三分位・同値は上側） */
function lengthClasses(row: TrackedLegRow): (number | null)[] {
  const ave3 = row.lap_sec.map((lap, l) => {
    const sp = row.leg_speed[l];
    return lap != null && sp != null && sp > 0 ? (100 * lap) / sp : null;
  });
  const valid = row.lap_sec.map((lap, l) => {
    const loss = row.leg_loss_sec[l];
    const sp = row.leg_speed[l];
    return lap != null && loss != null && sp != null && lap > 0 && lap - loss > 0 && sp > 0 && sp <= 3000;
  });
  const sorted = ave3.filter((v, l): v is number => v != null && valid[l]).sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length / 3)] ?? Infinity;
  const q2 = sorted[Math.floor((2 * sorted.length) / 3)] ?? Infinity;
  return ave3.map((v) => (v == null ? null : v < q1 ? 0 : v < q2 ? 1 : 2));
}

/** 明細のレース属性が元の出走行と一致するか */
function verifyRaceSource(who: string, race: DetailRace, row: TrackedLegRow, disc: "f" | "s"): void {
  const kind = row.race_type === "sprint" ? "s" : "f";
  if (row.event_date !== race.d || row.event_name !== race.e || row.class_name !== race.c) {
    fail(who, `レース ${race.ev}/${race.cl}/${race.ri} の日付・大会名・クラスが元データと不一致`);
  }
  if (row.lap_sec.length !== race.L) fail(who, `レース ${race.ev}/${race.cl}/${race.ri} のレッグ数が元データと不一致`);
  if (kind !== disc) fail(who, `レース ${race.ev}/${race.cl}/${race.ri} の種目が元データと不一致`);
}

/** 明細のレッグが元の出走行の同じ番号のレッグと一致するか（ラップ・想定との差・レッグ長の区分） */
function verifyLegSource(who: string, d: DisciplineDetail, rows: TrackedLegRow[]): void {
  const lenCache = new Map<number, (number | null)[]>();
  const { r, l, c, lap, loss } = d.legs;
  for (let i = 0; i < r.length; i++) {
    const row = rows[r[i]];
    if (row.lap_sec[l[i]] !== lap[i] || row.leg_loss_sec[l[i]] !== loss[i]) {
      fail(who, `legs[${i}] のラップ/想定との差が元データの第${l[i]}レッグと不一致`);
    }
    const lens = lenCache.get(r[i]) ?? lengthClasses(row);
    lenCache.set(r[i], lens);
    const len = lens[l[i]] ?? 1; // 集計側と同じく Ave3 不明は中レッグ扱い
    if (c[i] % 3 !== len) fail(who, `legs[${i}] のレッグ長の区分が元データからの再計算と不一致`);
  }
}

interface SourceFinisher {
  row: unknown;
  loss: (number | null)[];
}

/** 本人を除く完走者の第 l レッグの値から中央値と人数を数え直す（集計側の関数は使わない） */
function recountField(finishers: SourceFinisher[], self: unknown, l: number): { med: number | null; n: number } {
  const vals = finishers
    .filter((f) => f.row !== self)
    .map((f) => f.loss[l])
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  if (vals.length === 0) return { med: null, n: 0 };
  const h = vals.length >> 1;
  return { med: vals.length % 2 === 1 ? vals[h] : (vals[h - 1] + vals[h]) / 2, n: vals.length };
}

/** 明細のフィールド中央値・人数が、同じクラスの元の行（tracked＋companion の完走者）からの再計算と一致するか */
function verifyFieldSource(
  who: string,
  d: DisciplineDetail,
  rows: TrackedLegRow[],
  byClass: Map<string, SourceFinisher[]>
): void {
  const { r, l, fm, fn } = d.legs;
  for (let i = 0; i < r.length; i++) {
    const race = d.races[r[i]];
    const got = recountField(byClass.get(`${race.ev}:${race.cl}`) ?? [], rows[r[i]], l[i]);
    if (got.med !== fm[i] || got.n !== fn[i]) {
      fail(who, `legs[${i}] のフィールド中央値/人数が元データからの再計算と不一致（明細 ${fm[i]}/${fn[i]}・再計算 ${got.med}/${got.n}）`);
    }
  }
}

/**
 * 明細の各レース・各レッグを元データ（tracked 行＋companion 行）と突き合わせる。
 * 出走行は (選手キー, 大会ID, クラスID, 走者番号) で1行に特定できなければ不一致とする。
 */
export function verifyDetailsAgainstSource(
  details: FingerprintDetails,
  tracked: TrackedLegRow[],
  companions: CompanionRow[]
): void {
  const byKey = new Map<string, TrackedLegRow[]>();
  for (const row of tracked) {
    const k = sourceKey(row.runner_key, row.lc_event_id, row.lc_class_id, row.runner_index ?? null);
    byKey.set(k, [...(byKey.get(k) ?? []), row]);
  }
  const byClass = new Map<string, SourceFinisher[]>();
  for (const row of [...tracked, ...companions]) {
    if (row.rank == null) continue;
    const k = `${row.lc_event_id}:${row.lc_class_id}`;
    const list = byClass.get(k) ?? [];
    list.push({ row, loss: row.leg_loss_sec });
    byClass.set(k, list);
  }
  for (const [name, athlete] of Object.entries(details)) {
    for (const disc of ["f", "s"] as const) {
      const d = athlete[disc];
      if (!d) continue;
      const who = `${name}/${disc}`;
      const rows = d.races.map((race) => {
        const found = byKey.get(sourceKey(name, race.ev, race.cl, race.ri)) ?? [];
        if (found.length !== 1) fail(who, `レース ${race.ev}/${race.cl}/${race.ri} の元データが ${found.length} 行（1行に特定できない）`);
        verifyRaceSource(who, race, found[0], disc);
        return found[0];
      });
      verifyLegSource(who, d, rows);
      verifyFieldSource(who, d, rows, byClass);
    }
  }
}

/** 明細が集計（カードの数字）と完全に一致するかを全選手×全種目で検証する。不一致は例外 */
export function verifyFingerprintDetails(index: LegFingerprintIndex, details: FingerprintDetails): void {
  for (const name of Object.keys(details)) {
    if (!index.athletes[name]) fail(name, "集計に無い選手の明細がある");
  }
  for (const [name, athlete] of Object.entries(index.athletes)) {
    for (const disc of ["f", "s"] as const) {
      const fp = athlete[disc];
      const d = details[name]?.[disc];
      if (!fp) {
        if (d) fail(`${name}/${disc}`, "集計に無い種目の明細がある");
        continue;
      }
      if (!d) fail(`${name}/${disc}`, "明細が欠落している");
      verifyDiscipline(`${name}/${disc}`, fp, d, disc, index.params, index.periodCutoff);
    }
  }
}
