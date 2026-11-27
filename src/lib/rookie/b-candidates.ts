/**
 * B クラス候補（21A を走っている学生のうち、B でも上位 4 分の 1 に入らない人）。
 * 計画: docs/plans/2026-11-27_b-class-candidates.md
 *
 * 同じ大会で 21A と B が走った回だけを使い、1km あたりのタイムで
 * 「B に出ていたら B の何 % の人より遅いか」を出す。女子は男女のペースの比で補正する。
 */
import { affiliationOf, classTier, isIsoDate, MAX_ROOKIE_YEAR, rookieStatus } from "./rules";
import type { Affiliation, JoaFirstRegistration, RaceResult } from "./types";

export const B_CANDIDATE_RULES = {
  /** 直近何か月の大会を使うか */
  windowMonths: 12,
  /** 比べられた大会が何回以上の人を載せるか */
  minRaces: 2,
  /** B の人数がこれ未満の大会は使わない */
  minBField: 4,
  /** B の何 % の人より遅ければ候補か（＝B の上位 25% に入らない） */
  slowerThanShare: 0.25,
  /** 男女の比を出すときに、W21A・M21A それぞれ何人必要か */
  topN: 3,
} as const;

export type PaceBand = "上位 25〜50%" | "上位 50〜75%" | "下位 25%";

export interface ClassDistance {
  lcEventId: number;
  lcClassId: number;
  km: number;
}

export interface BCandidate {
  name: string;
  nameKey: string;
  club: string;
  affiliation: Affiliation;
  /** 今年度で何年目か */
  year: number;
  /** 比べられた大会の数 */
  races: number;
  band: PaceBand;
  linkable: boolean;
}

export interface BCandidateInput {
  results: readonly RaceResult[];
  distances: readonly ClassDistance[];
  joa: ReadonlyMap<string, JoaFirstRegistration>;
  lcFirst: ReadonlyMap<string, string>;
  linkableKeys: ReadonlySet<string>;
  currentFy: number;
  /** YYYY-MM-DD（JST） */
  today: string;
}

/** 21A とその組分け（M21A1・W21AS など）。年齢別 A・E・B は含めない */
export function isA21(className: string): boolean {
  return classTier(className) === "A" && /21A/.test(className);
}

const isFemale = (className: string) => /^W/.test(className.trim());

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? NaN : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function paceBand(slowerThanShare: number): PaceBand {
  if (slowerThanShare < 0.5) return "上位 25〜50%";
  if (slowerThanShare < 0.75) return "上位 50〜75%";
  return "下位 25%";
}

interface PacedRace {
  result: RaceResult;
  /** 1km あたりの秒数 */
  pace: number;
}

function pacedByEvent(results: readonly RaceResult[], km: ReadonlyMap<string, number>): Map<number, PacedRace[]> {
  const out = new Map<number, PacedRace[]>();
  for (const r of results) {
    const d = km.get(`${r.lcEventId}:${r.lcClassId}`);
    if (!d || d <= 0 || !r.resultSec || r.resultSec <= 0) continue;
    out.set(r.lcEventId, [...(out.get(r.lcEventId) ?? []), { result: r, pace: r.resultSec / d }]);
  }
  return out;
}

const topMedian = (paces: readonly number[], n: number) => median([...paces].sort((a, b) => a - b).slice(0, n));

/** 女子の補正: 同じ大会の W21A と M21A の上位 n 人のペースの比の、大会をまたいだ中央値 */
export function femalePaceFactor(results: readonly RaceResult[], km: ReadonlyMap<string, number>): number {
  const n = B_CANDIDATE_RULES.topN;
  const ratios: number[] = [];
  for (const races of pacedByEvent(results, km).values()) {
    const a21 = races.filter((x) => isA21(x.result.className));
    const w = a21.filter((x) => isFemale(x.result.className)).map((x) => x.pace);
    const m = a21.filter((x) => !isFemale(x.result.className)).map((x) => x.pace);
    if (w.length >= n && m.length >= n) ratios.push(topMedian(w, n) / topMedian(m, n));
  }
  return median(ratios);
}

function monthsBefore(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function mostCommon(values: readonly (string | null)[]): string {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}

/** LapCenter の所属名の末尾に付く組分けの数字（「大阪大学2」）を外す */
export function displayClub(club: string): string {
  return club.replace(/(\D)\d+$/, "$1");
}

const AFF_ORDER: Record<Affiliation, number> = { 大学: 0, 中高: 1, 一般: 2 };

/** 学生ごとの「B の何 % の人より遅いか」（大会ごと） */
function studentShares(results: readonly RaceResult[], km: ReadonlyMap<string, number>, factor: number) {
  const shares = new Map<string, { share: number; result: RaceResult }[]>();
  for (const races of pacedByEvent(results, km).values()) {
    const bPaces = races.filter((x) => classTier(x.result.className) === "B").map((x) => x.pace);
    if (bPaces.length < B_CANDIDATE_RULES.minBField) continue;
    for (const x of races) {
      if (!isA21(x.result.className) || affiliationOf(x.result.club) === "一般") continue;
      const pace = isFemale(x.result.className) ? x.pace / factor : x.pace;
      const share = bPaces.filter((b) => b < pace).length / bPaces.length;
      const key = x.result.runnerKey;
      shares.set(key, [...(shares.get(key) ?? []), { share, result: x.result }]);
    }
  }
  return shares;
}

export function buildBCandidates(input: BCandidateInput): BCandidate[] {
  const from = monthsBefore(input.today, B_CANDIDATE_RULES.windowMonths);
  const results = input.results.filter((r) => isIsoDate(r.eventDate) && r.eventDate > from && r.eventDate <= input.today);
  const km = new Map(input.distances.map((d) => [`${d.lcEventId}:${d.lcClassId}`, d.km]));
  const factor = femalePaceFactor(results, km);
  if (!Number.isFinite(factor) || factor <= 0) return [];

  const out: BCandidate[] = [];
  for (const [key, races] of studentShares(results, km, factor)) {
    if (races.length < B_CANDIDATE_RULES.minRaces) continue;
    const share = median(races.map((x) => x.share));
    if (share < B_CANDIDATE_RULES.slowerThanShare) continue;
    const club = displayClub(mostCommon(races.map((x) => x.result.club)));
    const status = rookieStatus(key, input.joa.get(key), input.lcFirst.get(key) ?? null, club);
    if (status.kind !== "rookie") continue;
    const year = input.currentFy - status.startFy + 1;
    if (year < 1 || year > MAX_ROOKIE_YEAR) continue;
    out.push({
      name: races[0].result.runnerName.replace(/　/g, " "),
      nameKey: key,
      club,
      affiliation: affiliationOf(club),
      year,
      races: races.length,
      band: paceBand(share),
      linkable: input.linkableKeys.has(key),
    });
  }
  // 漢字の名前は読みが分からず名前順にできないため、所属ごとにまとめる（速さの順にはしない）
  return out.sort(
    (a, b) =>
      AFF_ORDER[a.affiliation] - AFF_ORDER[b.affiliation] || a.club.localeCompare(b.club, "ja") || a.nameKey.localeCompare(b.nameKey, "ja"),
  );
}

/** 年度の境目をまたぐ 12 か月分を取るための開始日（ビルドで使う） */
export function bCandidateWindowFrom(today: string): string {
  return monthsBefore(today, B_CANDIDATE_RULES.windowMonths);
}

