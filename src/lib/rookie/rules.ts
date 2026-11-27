/**
 * ルーキーリーグの判定規則（クラス区分・年度・何年目か・所属区分）。
 * 数値と条件は docs/plans/2026-11-27_rookie-league.md の「決定」と一致させる。
 */
import type { Affiliation, ClassTier, JoaFirstRegistration, RookieSource } from "./types";

/** B 部門に数えるクラス（許可リスト。年齢別 B・「-B」の組分けは含めない） */
const B_CLASSES = new Set([
  "B", "MB", "WB", "BM", "BW", "BL", "MBL", "WBL", "LB", "BS",
  "男子B", "女子B", "M21B", "W21B", "B1", "B2", "B3", "B4", "race-B",
]);
const E_RE = /^(M|W)(21)?E(-[A-C])?$/;
/** 一般向けの A（21A とその組分け・AL/AS）。年齢別 A（M20A・M50A 等）は含めない */
const A_RE = /^((M|W)21A\d?(-[A-C])?|(M|W)21A(S|L)|(M|W)?A(S|L|M)?\d?)$/;

export function classTier(className: string): ClassTier | null {
  const c = className.trim();
  if (B_CLASSES.has(c)) return "B";
  if (E_RE.test(c)) return "E";
  if (A_RE.test(c)) return "A";
  return null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(d: string | null | undefined): d is string {
  return typeof d === "string" && DATE_RE.test(d);
}

/** 年度（4 月始まり） */
export function fiscalYear(date: string): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return m >= 4 ? y : y - 1;
}

/** 1〜3 月（年度の最後の 3 か月）に始まった人は、翌年度を 1 年目とする（年度後半の救済） */
export function startFyWithRescue(firstFy: number, startDate: string | null): number {
  if (!isIsoDate(startDate)) return firstFy;
  const m = Number(startDate.slice(5, 7));
  return m >= 1 && m <= 3 && fiscalYear(startDate) === firstFy ? firstFy + 1 : firstFy;
}

/** 名簿で遡れる最初の年度。ここに名簿がある人は「いつからか分からない」ので対象外 */
export const JOA_OLDEST_FY = 2019;
/** LapCenter の記録が途切れず揃う最初の年度 */
export const LC_OLDEST_FY = 2019;
export const MAX_ROOKIE_YEAR = 2;

const SUFFIX_RE = /（.+）/;
const ASCII_CLUB_RE = /^[A-Za-z0-9 .\-&/]+$/;

export type RookieStatus =
  | { kind: "rookie"; source: RookieSource; startFy: number }
  | { kind: "excluded"; reason: "veteran" | "returner" | "homonym" | "foreign" | "unknown" };

/**
 * 新人かどうか（何年目かはレースの年度で決まるので、ここでは 1 年目の年度 startFy を返す）。
 * - JOA: 名簿の初登録年度（年度後半の救済つき）
 * - 未登録: LapCenter の初出年度（同じ救済つき）
 */
export function rookieStatus(
  nameKey: string,
  joa: JoaFirstRegistration | undefined,
  lcFirstDate: string | null,
  club: string | null,
): RookieStatus {
  if (SUFFIX_RE.test(nameKey)) return { kind: "excluded", reason: "homonym" };
  if (joa) {
    if (joa.firstFy <= JOA_OLDEST_FY) return { kind: "excluded", reason: "veteran" };
    // 初登録より 2 年以上前から LapCenter に出ている＝名簿の空白期間がある復帰者とみなす
    if (isIsoDate(lcFirstDate) && lcFirstDate < `${joa.firstFy - 1}-04-01`) {
      return { kind: "excluded", reason: "returner" };
    }
    return { kind: "rookie", source: "JOA", startFy: startFyWithRescue(joa.firstFy, joa.firstValidFrom) };
  }
  const c = (club ?? "").trim();
  if (c && ASCII_CLUB_RE.test(c) && /[A-Za-z]/.test(c)) return { kind: "excluded", reason: "foreign" };
  if (!isIsoDate(lcFirstDate)) return { kind: "excluded", reason: "unknown" };
  const lcFy = fiscalYear(lcFirstDate);
  if (lcFy <= LC_OLDEST_FY) return { kind: "excluded", reason: "veteran" };
  return { kind: "rookie", source: "未登録", startFy: startFyWithRescue(lcFy, lcFirstDate) };
}

const JH_RE = /中学|高校|高等学校|中等|学園|小学|桐朋|麻布|開成/;
const UNI_RE = /大学|大OL|大OC|大OK|大OLK|大OLC|大OLT|東大|京大|阪大|早大|慶應|慶大|筑波|北大|東北大/;

export function affiliationOf(club: string | null): Affiliation {
  const c = club ?? "";
  if (JH_RE.test(c)) return "中高";
  if (UNI_RE.test(c)) return "大学";
  return "一般";
}
