/**
 * ミスの傾向（クロスレース）のドリルダウン表示用の純関数。
 * docs/plans/2026-09-30_miss-trend-drilldown.md §4.2
 *
 * 明細（leg-fingerprint-details.ts の DisciplineDetail）から、選んだセル・規模の行を集め、
 * 並べ替え・文言化する。明細は集計と一致検証済み（ビルド時）なので、ここでは数え直さない。
 * UI 文言では「ロス」を使わない（界隈で使わない表現・feedback_orienteering_no_loss_wording）。
 */
import { legLabel } from "@/lib/results/leg-analysis";
import type { DetailRace, DisciplineDetail } from "./leg-fingerprint-details";

/** 何を開いたか: 3×3 セル（局面*3+レッグ長）か、ミスの規模ビン（0小/1中/2大） */
export type DrilldownSelection = { kind: "cell"; cell: number } | { kind: "sev"; bin: 0 | 1 | 2 };

export type DrilldownOrder = "date" | "delta";

/** 開いている一覧（種目＋セル/規模）。URL の ?fp= に残し、結果分析ページから「戻る」で復元する */
export interface DrilldownOpen {
  disc: "f" | "s";
  sel: DrilldownSelection;
}

/** ?fp= の値: "f-c3"（フォレストのセル3）/ "s-s2"（スプリントの規模「大」） */
export function encodeFpParam(open: DrilldownOpen): string {
  return `${open.disc}-${open.sel.kind === "cell" ? `c${open.sel.cell}` : `s${open.sel.bin}`}`;
}

/** ?fp= を読み戻す。範囲外・不正な値は null（手で書き換えられた URL でも落とさない） */
export function parseFpParam(value: string | null | undefined): DrilldownOpen | null {
  const m = value?.match(/^([fs])-([cs])(\d)$/);
  if (!m) return null;
  const disc = m[1] as "f" | "s";
  const n = Number(m[3]);
  if (m[2] === "c") return n <= 8 ? { disc, sel: { kind: "cell", cell: n } } : null;
  return n <= 2 ? { disc, sel: { kind: "sev", bin: n as 0 | 1 | 2 } } : null;
}

export interface DrilldownRow {
  raceIdx: number;
  legIdx: number;          // コース上のレッグ番号（0始まり）
  date: string;
  event: string;
  className: string | null;
  ev: number;
  cl: number;
  ri: number | null;
  legLabel: string;        // "S→1" / "8→9" / "19→F"（結果分析ページと同じ表記）
  lapSec: number;
  deltaSec: number;        // 想定タイムとの差（＋遅い／−速い）
  deltaPct: number;        // 想定タイム比（%・四捨五入）
  miss: boolean;
  sevBin: 0 | 1 | 2 | null; // ミス判定レッグの規模（小/中/大）。ミス判定なしは null
}

export interface Drilldown {
  n: number;
  m: number;
  miss: DrilldownRow[];
  clean: DrilldownRow[];
}

function toRow(detail: DisciplineDetail, i: number, sevBins: [number, number]): DrilldownRow {
  const { r, l, lap, loss, m } = detail.legs;
  const race = detail.races[r[i]];
  const miss = m[i] === 1;
  const base = lap[i] - loss[i];
  return {
    raceIdx: r[i],
    legIdx: l[i],
    date: race.d,
    event: race.e,
    className: race.c,
    ev: race.ev,
    cl: race.cl,
    ri: race.ri,
    legLabel: legLabel(l[i], race.L),
    lapSec: lap[i],
    deltaSec: loss[i],
    deltaPct: base > 0 ? Math.round((loss[i] / base) * 100) : 0,
    miss,
    sevBin: miss ? (loss[i] < sevBins[0] ? 0 : loss[i] < sevBins[1] ? 1 : 2) : null,
  };
}

/** 選んだセル（全レッグ）または規模ビン（ミス判定レッグのみ）の行を集める */
export function buildDrilldown(
  detail: DisciplineDetail,
  selection: DrilldownSelection,
  sevBins: [number, number]
): Drilldown {
  const rows = detail.legs.r.map((_, i) => toRow(detail, i, sevBins));
  const picked =
    selection.kind === "cell"
      ? rows.filter((_, i) => detail.legs.c[i] === selection.cell)
      : rows.filter((row) => row.sevBin === selection.bin);
  const miss = picked.filter((row) => row.miss);
  const clean = picked.filter((row) => !row.miss);
  return { n: picked.length, m: miss.length, miss, clean };
}

/** 並べ替えた新しい配列を返す。date=日付の新しい順（同じレースはレッグ順）/ delta=想定との差が大きい順 */
export function sortDrilldownRows(rows: readonly DrilldownRow[], order: DrilldownOrder): DrilldownRow[] {
  const byDate = (a: DrilldownRow, b: DrilldownRow) =>
    b.date.localeCompare(a.date) || a.raceIdx - b.raceIdx || a.legIdx - b.legIdx;
  return [...rows].sort(order === "delta" ? (a, b) => b.deltaSec - a.deltaSec || byDate(a, b) : byDate);
}

function formatSeconds(sec: number): string {
  const s = Math.round(Math.abs(sec));
  return s >= 60 ? `${Math.floor(s / 60)}分${s % 60}秒` : `${s}秒`;
}

/** 想定タイムとの差の文言。速いレッグは「+-6秒」でなく「6秒速い」と書き分ける */
export function formatDelta(deltaSec: number, deltaPct: number): string {
  if (Math.round(deltaSec) === 0) return "想定どおり";
  if (deltaSec < 0) return `想定より ${formatSeconds(deltaSec)}速い`;
  return `想定より +${formatSeconds(deltaSec)}（+${deltaPct}%）`;
}

/** ラップ秒 → m:ss */
export function formatLap(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface ExcludedRace {
  date: string;
  event: string;
  className: string | null;
  reason: "pack" | "clean";
}

/** 集計対象外の内訳（不採用レース・集団走で除いたレッグ数・スタート時刻不明で未チェックのレース数） */
export function excludedSummary(detail: DisciplineDetail): {
  races: ExcludedRace[];
  packLegs: number;
  packUnchecked: number;
} {
  const races = detail.races
    .filter((race): race is DetailRace & { x: "pack" | "clean" } => race.x != null)
    .map((race) => ({ date: race.d, event: race.e, className: race.c, reason: race.x }));
  return {
    races,
    packLegs: detail.pack.r.length,
    packUnchecked: detail.races.filter((race) => race.pu === 1).length,
  };
}

/** 行から結果分析ページ（そのレース・そのレッグ）へのリンク */
export function drilldownHref(row: DrilldownRow, athleteKey: string, discipline: "forest" | "sprint"): string {
  const params = new URLSearchParams({ athlete: athleteKey });
  if (row.ri != null) params.set("ri", String(row.ri));
  params.set("leg", String(row.legIdx));
  params.set("disc", discipline);
  params.set("d", row.date);
  if (row.className) params.set("cn", row.className);
  return `/results/${row.ev}/${row.cl}?${params.toString()}`;
}
