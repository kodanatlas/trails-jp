/**
 * LapCenter split-list（detailed パース結果）から
 * (a) lc_performances 向けスカラー行（既存 cron とビット同一の選別規則）
 * (b) lc_leg_splits 向け per-leg 行（全走者・relay-first）
 * を同時に組み立てる純関数。cron と backfill スクリプトが共用する。
 *
 * relay-first: 値の再計算はしない。"12:34" → 秒の単位変換のみ（lapStrToSeconds を relay）。
 */
import type { LapCenterRunnerDetail } from "@/lib/scraper/lapcenter-detail";
import { lapStrToSeconds } from "@/lib/scraper/lapcenter-detail";

export const SPRINT_KEYWORDS = ["スプリント", "Sprint", "sprint", "パークO", "パーク・オリエンテーリング"];

export const CLUB_ALIASES: Record<string, string> = {
  "北大": "北海道大学", "東北大": "東北大学", "東大": "東京大学",
  "名大": "名古屋大学", "京大": "京都大学", "阪大": "大阪大学",
  "九大": "九州大学", "筑波大": "筑波大学", "千葉大": "千葉大学",
  "横国大": "横浜国立大学", "金大": "金沢大学", "新大": "新潟大学",
  "岡大": "岡山大学", "広大": "広島大学", "熊大": "熊本大学",
  "信大": "信州大学", "静大": "静岡大学",
  "大阪": "大阪OLC", "練馬": "練馬OLC", "レオ": "OLCレオ",
  "東京科学大OLT": "東京科学大学",
};

export function normalizeClub(club: string): string {
  let s = club;
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
  s = s.replace(/olc/gi, "OLC").replace(/olk/gi, "OLK");
  s = s.replace(/OLクラブ/g, "OLC");
  s = s.replace(/OLC$/, "").replace(/OLK$/, "");
  s = s.trim();
  if (CLUB_ALIASES[s]) s = CLUB_ALIASES[s];
  return s;
}

export function isSprint(eventName: string): boolean {
  return SPRINT_KEYWORDS.some((kw) => eventName.includes(kw));
}

export interface AthleteLookupEntry {
  joyName: string;
  clubs: string[];
}

/** lc_performances 行（既存 cron の eventRecords と同形） */
export interface ScalarRecord {
  athlete_name: string;
  event_date: string;
  event_name: string;
  class_name: string;
  cruising_speed: number;
  miss_rate: number;
  race_type: string;
}

/** lc_leg_splits 行 */
export interface LegSplitRow {
  lc_event_id: number;
  lc_class_id: number;
  event_date: string;
  event_name: string;
  class_name: string;
  race_type: "forest" | "sprint";
  runner_index: number;
  runner_name: string;
  runner_key: string;
  club: string | null;
  rank: number | null;
  result_sec: number | null;
  start_time: string | null;
  speed: number | null;
  loss_rate: number | null;
  ideal_sec: number | null;
  total_loss_sec: number | null;
  lap_sec: (number | null)[];
  lap_rank: (number | null)[];
  elapsed_sec: (number | null)[];
  elapsed_rank: (number | null)[];
  leg_loss_sec: (number | null)[];
  leg_speed: (number | null)[];
  tracked: boolean;
}

/** 追跡選手か（名前＋クラブ照合）。cron の判定（route.ts 旧239-252行）と同一規則 */
function matchTracked(
  r: LapCenterRunnerDetail,
  athleteLookup: Map<string, AthleteLookupEntry>
): AthleteLookupEntry | null {
  const normalized = r.name.replace(/\s+/g, "");
  const entry = athleteLookup.get(normalized);
  if (!entry) return null;
  const lcClubs = r.club ? r.club.split("/").map((c) => normalizeClub(c)) : [];
  const joyClubs = entry.clubs.map((c) => normalizeClub(c));
  const clubMatch =
    lcClubs.length === 0 ||
    joyClubs.length === 0 ||
    lcClubs.some((lc) =>
      joyClubs.some((joy) => lc === joy || lc.includes(joy) || joy.includes(lc))
    );
  return clubMatch ? entry : null;
}

export interface ClassIngestArgs {
  detailed: LapCenterRunnerDetail[];
  athleteLookup: Map<string, AthleteLookupEntry>;
  lcEventId: number;
  lcClassId: number;
  eventDate: string;
  eventName: string;
  className: string;
  raceType: "forest" | "sprint";
}

/**
 * 1クラス分のパース結果から scalar 行と per-leg 行を組み立てる。
 * - scalarRecords: 旧 fetchSplitList パスと同一の選別
 *   （rank なし skip＝旧 lapcenter.ts:414-416 / speed・miss なし skip＝旧 :412 /
 *     追跡選手＋クラブ照合＝旧 route.ts:239-252 / speed=100&miss=0 skip＝旧 :255）
 * - legRows: クラスに追跡選手が1人もいなければ空（クラス保持ルール）。
 *   いれば**全走者**を保存（MP/DISQ/DNS も rank=null で保持・フィールド基盤に必要）。
 *   tracked は名前＋クラブ照合のみで判定（MP でも tracked）。
 */
export function buildClassIngest(args: ClassIngestArgs): {
  scalarRecords: ScalarRecord[];
  legRows: LegSplitRow[];
} {
  const { detailed, athleteLookup, lcEventId, lcClassId, eventDate, eventName, className, raceType } = args;

  const scalarRecords: ScalarRecord[] = [];
  let anyTracked = false;
  const trackedFlags: boolean[] = [];

  for (const r of detailed) {
    const entry = matchTracked(r, athleteLookup);
    trackedFlags.push(entry != null);
    if (entry) anyTracked = true;

    // ---- scalar 行（旧パスとビット同一の選別） ----
    if (r.rank == null) continue; // 旧 fetchSplitList: isNaN(rank) → skip
    if (r.speed == null || r.lossRate == null) continue; // 旧: NaN speed/missRate → skip
    if (!entry) continue; // 旧 cron: 追跡選手＋クラブ照合
    if (r.speed === 100 && r.lossRate === 0) continue; // 旧 cron: 基準ランナー除外
    scalarRecords.push({
      athlete_name: entry.joyName,
      event_date: eventDate,
      event_name: eventName,
      class_name: className,
      cruising_speed: r.speed,
      miss_rate: r.lossRate,
      race_type: raceType,
    });
  }

  if (!anyTracked) return { scalarRecords, legRows: [] };

  const legRows: LegSplitRow[] = detailed.map((r, i) => ({
    lc_event_id: lcEventId,
    lc_class_id: lcClassId,
    event_date: eventDate,
    event_name: eventName,
    class_name: className,
    race_type: raceType,
    runner_index: r.index,
    runner_name: r.name,
    runner_key: r.name.replace(/\s+/g, ""),
    club: r.club || null,
    rank: r.rank,
    result_sec: lapStrToSeconds(r.result),
    start_time: r.start || null,
    speed: r.speed,
    loss_rate: r.lossRate,
    ideal_sec: lapStrToSeconds(r.idealTime),
    total_loss_sec: lapStrToSeconds(r.totalLossTime),
    lap_sec: r.lapTime.map(lapStrToSeconds),
    lap_rank: r.lapRank,
    elapsed_sec: r.elapsedTime.map(lapStrToSeconds),
    elapsed_rank: r.elapsedRank,
    leg_loss_sec: r.legLossTime.map(lapStrToSeconds),
    leg_speed: r.legSpeed.map((v) => (v == null ? null : Math.round(v))),
    tracked: trackedFlags[i],
  }));

  return { scalarRecords, legRows };
}
