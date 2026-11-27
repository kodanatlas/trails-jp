/** ルーキーリーグ（B 部門）の型。計画: docs/plans/2026-11-27_rookie-league.md */

export type ClassTier = "B" | "A" | "E";

/** LapCenter の 1 出走（lc_leg_splits の必要列だけ） */
export interface RaceResult {
  lcEventId: number;
  lcClassId: number;
  eventDate: string; // YYYY-MM-DD
  eventName: string;
  className: string;
  runnerName: string;
  runnerKey: string;
  club: string | null;
  rank: number | null;
  resultSec: number | null;
}

/** JOA 競技者登録の初登録（名簿の年度スナップショットから算出） */
export interface JoaFirstRegistration {
  nameKey: string;
  /** 初めて名簿に出た年度（4 月始まり） */
  firstFy: number;
  /** 初めて出た年度の有効化日（YYYY-MM-DD。不明なら null） */
  firstValidFrom: string | null;
}

export type RookieSource = "JOA" | "未登録";
export type Affiliation = "大学" | "中高" | "一般";

export interface RookieEntry {
  rank: number;
  name: string;
  nameKey: string;
  club: string;
  affiliation: Affiliation;
  source: RookieSource;
  /** そのシーズンで何年目か（1 or 2） */
  year: number;
  /** 上位 2 戦の平均 ×1000（小数 1 桁） */
  score: number;
  bRaces: number;
  graduated: boolean;
  /** 選手ページ（/a/<key>）があるか */
  linkable: boolean;
  best: { date: string; eventName: string; className: string; ratio: number; field: number; points: number }[];
}

export interface RookieSeason {
  fy: number;
  label: string;
  from: string;
  to: string;
  entries: RookieEntry[];
}

export interface RookieLeagueData {
  generatedAtJst: string;
  seasons: RookieSeason[];
}
