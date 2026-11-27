/**
 * ルーキーリーグ B 部門の点数計算。
 * 1 大会の点 = min(上位 3 人の平均タイム / 自分のタイム, 1.05) × n/(n+2)（4 人未満のクラスは使わない）
 * 順位 = 上位 2 戦の平均（足りない分は 0 点）× 1000
 * 卒業 = A/E で素の比 0.85 以上（20 人以上のクラス）を出した日から後の B は数えない
 */
import { affiliationOf, classTier, fiscalYear, isIsoDate, MAX_ROOKIE_YEAR, rookieStatus } from "./rules";
import type { ClassTier, JoaFirstRegistration, RaceResult, RookieEntry } from "./types";

export const SCORING = {
  refTopK: 3,
  ratioCap: 1.05,
  shrinkN0: 2,
  fieldMin: 4,
  countedRaces: 2,
  graduateRatio: 0.85,
  graduateField: 20,
} as const;

interface ScoredRace {
  tier: ClassTier;
  date: string;
  eventName: string;
  className: string;
  ratio: number;
  field: number;
  points: number;
  club: string | null;
  runnerName: string;
}

/** クラスごとに基準タイムを出し、各出走の比と点を付ける（年度で絞った入力を渡す） */
export function scoreRaces(results: readonly RaceResult[]): Map<string, ScoredRace[]> {
  const byClass = new Map<string, { r: RaceResult; tier: ClassTier; sec: number }[]>();
  for (const r of results) {
    const tier = classTier(r.className);
    if (!tier || !isIsoDate(r.eventDate)) continue;
    if (r.rank == null || r.rank <= 0 || r.resultSec == null || !(r.resultSec > 0)) continue;
    const key = `${r.lcEventId}:${r.lcClassId}`;
    const list = byClass.get(key) ?? [];
    byClass.set(key, [...list, { r, tier, sec: r.resultSec }]);
  }
  const out = new Map<string, ScoredRace[]>();
  for (const rows of byClass.values()) {
    const n = rows.length;
    if (n < SCORING.fieldMin) continue;
    const top = rows.map((x) => x.sec).sort((a, b) => a - b).slice(0, SCORING.refTopK);
    const ref = top.reduce((s, x) => s + x, 0) / top.length;
    for (const { r, tier, sec } of rows) {
      const ratio = Math.min(ref / sec, SCORING.ratioCap);
      const scored: ScoredRace = {
        tier,
        date: r.eventDate,
        eventName: r.eventName,
        className: r.className,
        ratio,
        field: n,
        points: ratio * (n / (n + SCORING.shrinkN0)),
        club: r.club,
        runnerName: r.runnerName,
      };
      out.set(r.runnerKey, [...(out.get(r.runnerKey) ?? []), scored]);
    }
  }
  return out;
}

export interface BuildInput {
  fy: number;
  /** その年度の出走（他年度が混ざっていても除外する） */
  results: readonly RaceResult[];
  joa: ReadonlyMap<string, JoaFirstRegistration>;
  lcFirst: ReadonlyMap<string, string>;
  linkableKeys: ReadonlySet<string>;
}

function mostCommon(values: readonly (string | null)[]): string {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}

/** 年度 fy の B 部門の順位表 */
export function buildRookieTable(input: BuildInput): RookieEntry[] {
  const seasonResults = input.results.filter((r) => isIsoDate(r.eventDate) && fiscalYear(r.eventDate) === input.fy);
  const scored = scoreRaces(seasonResults);
  const rows: Omit<RookieEntry, "rank">[] = [];
  for (const [key, races] of scored) {
    const club = mostCommon(races.map((x) => x.club));
    const status = rookieStatus(key, input.joa.get(key), input.lcFirst.get(key) ?? null, club);
    if (status.kind !== "rookie") continue;
    const year = input.fy - status.startFy + 1;
    if (year < 1 || year > MAX_ROOKIE_YEAR) continue;
    const gradDates = races
      .filter((x) => x.tier !== "B" && x.ratio >= SCORING.graduateRatio && x.field >= SCORING.graduateField)
      .map((x) => x.date)
      .sort();
    const gradDate = gradDates[0];
    const bRaces = races.filter((x) => x.tier === "B" && (!gradDate || x.date < gradDate));
    if (bRaces.length === 0) continue;
    const best = [...bRaces].sort((a, b) => b.points - a.points).slice(0, SCORING.countedRaces);
    const score = (best.reduce((s, x) => s + x.points, 0) / SCORING.countedRaces) * 1000;
    rows.push({
      name: races[0].runnerName.replace(/　/g, " "),
      nameKey: key,
      club,
      affiliation: affiliationOf(club),
      source: status.source,
      year,
      score: Math.round(score * 10) / 10,
      bRaces: bRaces.length,
      graduated: Boolean(gradDate),
      linkable: input.linkableKeys.has(key),
      best: best.map((x) => ({
        date: x.date,
        eventName: x.eventName,
        className: x.className,
        ratio: Math.round(x.ratio * 1000) / 1000,
        field: x.field,
        points: Math.round(x.points * 10000) / 10,
      })),
    });
  }
  const sorted = [...rows].sort(
    (a, b) => b.score - a.score || (b.best[1]?.points ?? 0) - (a.best[1]?.points ?? 0) || a.nameKey.localeCompare(b.nameKey),
  );
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}
