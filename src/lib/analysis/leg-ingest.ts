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
import { isAliasedName, resolveAliasNameForLc } from "@/lib/identity/athlete-alias";

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
  athleteLookup: Map<string, AthleteLookupEntry>,
  lcEventId: number,
  lcClassId: number,
  clubs: string[] = r.club ? [r.club] : [],
): { entry: AthleteLookupEntry | null; unresolvedAlias: boolean } {
  const alias = resolveAliasNameForLc(
    r.name,
    clubs,
    lcEventId,
    lcClassId,
    r.index,
  );
  if (alias.kind === "unresolved") {
    return { entry: null, unresolvedAlias: isAliasedName(r.name) };
  }
  const normalized = alias.name.replace(/\s+/g, "");
  const entry = athleteLookup.get(normalized);
  if (!entry) return { entry: null, unresolvedAlias: false };
  if (alias.kind === "renamed") return { entry, unresolvedAlias: false };
  const lcClubs = clubs.flatMap((club) => club.split("/")).map((club) => normalizeClub(club));
  const joyClubs = entry.clubs.map((c) => normalizeClub(c));
  const clubMatch =
    lcClubs.length === 0 ||
    joyClubs.length === 0 ||
    lcClubs.some((lc) =>
      joyClubs.some((joy) => lc === joy || lc.includes(joy) || joy.includes(lc))
    );
  return { entry: clubMatch ? entry : null, unresolvedAlias: false };
}

export interface ClassIngestArgs {
  detailed: LapCenterRunnerDetail[];
  athleteLookup: Map<string, AthleteLookupEntry>;
  relayTeams?: ReadonlyMap<string, string>;
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
 * - legRows: クラスに追跡選手も所属未解決の別名候補もいなければ空（クラス保持ルール）。
 *   いれば**全走者**を保存（MP/DISQ/DNS も rank=null で保持・フィールド基盤に必要）。
 *   tracked は名前＋クラブ照合のみで判定（MP でも tracked）。
 */
export function buildClassIngest(args: ClassIngestArgs): {
  scalarRecords: ScalarRecord[];
  legRows: LegSplitRow[];
} {
  const {
    detailed,
    athleteLookup,
    relayTeams,
    lcEventId,
    lcClassId,
    eventDate,
    eventName,
    className,
    raceType,
  } = args;
  const runners = detailed.map((r) => {
    const relayClub = !r.club
      ? relayTeams?.get(`${r.name.replace(/\s+/g, "")}|${className}`)
      : undefined;
    const runner = r;
    // リレーのチーム名はクラブ名ではない（同一クラブが複数チームを出すため識別子が付く。
    // 実測で既知クラブと一致するのは正規クラスでも 6.3%）。よって解決にのみ使い、club には保存しない。
    // チーム名の語間空白は、照合時だけ空白なし表記も候補にする。
    // 例: "筑波大学51期 A" は既存の所属表 "筑波大学51期A" と一致する。
    const matchClubs = relayClub
      ? [relayClub, relayClub.replace(/\s+/g, "")]
      : r.club ? [r.club] : [];
    return { runner, matchClubs };
  });

  const scalarRecords: ScalarRecord[] = [];
  let anyTracked = false;
  const trackedFlags: boolean[] = [];

  for (const { runner, matchClubs } of runners) {
    const { entry, unresolvedAlias } = matchTracked(
      runner,
      athleteLookup,
      lcEventId,
      lcClassId,
      matchClubs,
    );
    trackedFlags.push(entry != null);
    if (entry || unresolvedAlias) anyTracked = true;

    // ---- scalar 行（旧パスとビット同一の選別） ----
    if (runner.rank == null) continue; // 旧 fetchSplitList: isNaN(rank) → skip
    if (runner.speed == null || runner.lossRate == null) continue; // 旧: NaN speed/missRate → skip
    if (!entry) continue; // 旧 cron: 追跡選手＋クラブ照合
    if (runner.speed === 100 && runner.lossRate === 0) continue; // 旧 cron: 基準ランナー除外
    scalarRecords.push({
      athlete_name: entry.joyName,
      event_date: eventDate,
      event_name: eventName,
      class_name: className,
      cruising_speed: runner.speed,
      miss_rate: runner.lossRate,
      race_type: raceType,
    });
  }

  if (!anyTracked) return { scalarRecords, legRows: [] };

  const legRows: LegSplitRow[] = runners.map(({ runner, matchClubs }, i) => {
    const alias = resolveAliasNameForLc(
      runner.name,
      matchClubs,
      lcEventId,
      lcClassId,
      runner.index,
    );
    const runnerName = alias.kind === "unresolved" ? runner.name : alias.name;
    const runnerKeyName =
      alias.kind === "unresolved" && isAliasedName(runner.name)
        ? `${runner.name}#unresolved`
        : runnerName;
    return {
      lc_event_id: lcEventId,
      lc_class_id: lcClassId,
      event_date: eventDate,
      event_name: eventName,
      class_name: className,
      race_type: raceType,
      runner_index: runner.index,
      runner_name: runner.name,
      runner_key: runnerKeyName.replace(/\s+/g, ""),
      club: runner.club || null,
      rank: runner.rank,
      result_sec: lapStrToSeconds(runner.result),
      start_time: runner.start || null,
      speed: runner.speed,
      loss_rate: runner.lossRate,
      ideal_sec: lapStrToSeconds(runner.idealTime),
      total_loss_sec: lapStrToSeconds(runner.totalLossTime),
      lap_sec: runner.lapTime.map(lapStrToSeconds),
      lap_rank: runner.lapRank,
      elapsed_sec: runner.elapsedTime.map(lapStrToSeconds),
      elapsed_rank: runner.elapsedRank,
      leg_loss_sec: runner.legLossTime.map(lapStrToSeconds),
      leg_speed: runner.legSpeed.map((v) => (v == null ? null : Math.round(v))),
      tracked: trackedFlags[i],
    };
  });

  return { scalarRecords, legRows };
}
