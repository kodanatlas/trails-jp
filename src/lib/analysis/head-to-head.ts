/**
 * 選手ページ「対戦成績（Head-to-Head）」の純ロジック。
 * UI（HeadToHead.tsx）から抽出し、vitest で検証可能にする。
 *
 * 勝敗判定は JOY ランキング換算点（totalPoints / EventScore.points）ベースで、
 * 実着順・タイムではない（表示側で明記）。
 */

import type {
  AthleteSummary,
  AthleteProfile,
  AthleteIndex,
  RankingAppearance,
  EventScore,
} from "./types";
import { stripEventNoise, eventFuzzyMatch } from "./event-match";

/** 無差別・Open 等の包括カテゴリ（順位が密で「近さ」判定を歪める）を検出 */
const UMBRELLA_RE = /無差別|open/i;
export function isUmbrellaClass(className: string): boolean {
  return UMBRELLA_RE.test(className);
}

/**
 * 同姓同名の合成エントリ判定: athlete-index は空白除去名キーのため、同姓同名の別人が
 * 1エントリに合成され同一 (type, className) の appearance が複数並ぶ。別人の成績が混ざるため
 * 候補選定から除外し、検索から選ばれた場合は表示側で caveat を出す。
 */
export function hasMergedNamesakes(a: Pick<AthleteSummary, "appearances">): boolean {
  const seen = new Set<string>();
  for (const r of a.appearances) {
    const k = `${r.type}__${r.className}`;
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

export interface Candidate {
  athlete: AthleteSummary;
  label: string;
}

/**
 * 「成績が近い選手」候補を同クラブ／他クラブから提示する。
 *
 * 近さの測り方（旧実装の生順位差問題を修正）:
 * - 共通 (type, className) のうち **専門クラス（年齢別・エリート）を包括カテゴリより優先**。
 *   包括カテゴリ（無差別/Open）は順位が密で、巨大母集団の隣接順位が本来のライバルを押しのける
 *   （例: 無差別580位に対し581位の別人が順位差1で最上位化）。専門クラスの共通があれば必ずそちらを使う。
 * - 同一クラス内の近さは **順位差でなく得点差**（totalPoints）で測る。順位差1の意味はカテゴリ規模で
 *   激変するが、換算点差はクラス横断でも比較しやすい。
 * - 同クラブ優先枠（既定4）。
 */
export function scoreCandidates(
  profile: Pick<AthleteProfile, "name" | "clubs" | "appearances">,
  athleteIndex: AthleteIndex,
  opts: { max?: number; sameClubQuota?: number } = {},
): Candidate[] {
  const MAX = opts.max ?? 8;
  const SAME_CLUB_QUOTA = opts.sameClubQuota ?? 4;
  const myClubs = new Set(profile.clubs);

  // 自分の現役 (type,className) → { rank, points }
  const mine = new Map<string, { rank: number; points: number }>();
  for (const r of profile.appearances) {
    mine.set(`${r.type}__${r.className}`, { rank: r.rank, points: r.totalPoints });
  }

  type Scored = {
    athlete: AthleteSummary;
    className: string;
    rank: number;
    umbrella: boolean;
    pointsDiff: number;
    sameClub: boolean;
  };
  const scored: Scored[] = [];
  for (const a of Object.values(athleteIndex.athletes)) {
    if (a.name === profile.name || hasMergedNamesakes(a)) continue;
    let best: { className: string; rank: number; umbrella: boolean; pointsDiff: number } | null = null;
    for (const app of a.appearances) {
      if (!app.isActive) continue; // 現役順位のみで近さを測る
      const m = mine.get(`${app.type}__${app.className}`);
      if (!m) continue;
      const umbrella = isUmbrellaClass(app.className);
      const pointsDiff = Math.abs(app.totalPoints - m.points);
      // 専門クラス優先 → 同種別なら得点差が小さい方
      const better =
        !best || (!umbrella && best.umbrella) || (umbrella === best.umbrella && pointsDiff < best.pointsDiff);
      if (better) best = { className: app.className, rank: app.rank, umbrella, pointsDiff };
    }
    if (!best) continue;
    scored.push({ athlete: a, ...best, sameClub: a.clubs.some((c) => myClubs.has(c)) });
  }

  // 専門クラス優先 → 得点差昇順 → 順位昇順 → 名前（決定的）
  scored.sort(
    (x, y) =>
      Number(x.umbrella) - Number(y.umbrella) ||
      x.pointsDiff - y.pointsDiff ||
      x.rank - y.rank ||
      x.athlete.name.localeCompare(y.athlete.name),
  );

  const sameClubList = scored.filter((s) => s.sameClub);
  const otherClubList = scored.filter((s) => !s.sameClub);
  const picked: Scored[] = [];
  const seen = new Set<string>([profile.name]);
  const take = (arr: Scored[], n: number) => {
    for (const s of arr) {
      if (picked.length >= MAX || n <= 0) break;
      if (seen.has(s.athlete.name)) continue;
      seen.add(s.athlete.name);
      picked.push(s);
      n--;
    }
  };
  take(sameClubList, SAME_CLUB_QUOTA);
  take(otherClubList, MAX - picked.length);
  take(sameClubList, MAX - picked.length); // 他クラブが少なければ同クラブで補充

  return picked.map((s) => ({
    athlete: s.athlete,
    label: `${s.sameClub ? "同クラブ・" : ""}${s.className} ${s.rank}位`,
  }));
}

export interface H2HRecord {
  date: string;
  eventName: string;
  myPoints: number;
  oppPoints: number;
  discipline: "forest" | "sprint";
  result: "win" | "loss" | "draw";
}

export interface Tally {
  win: number;
  loss: number;
  draw: number;
}

export interface H2HResult {
  records: H2HRecord[];
  total: Tally;
  forest: Tally;
  sprint: Tally;
  /** 平均得点差 avg(myPoints − oppPoints)（JOY換算点）。対戦0件は null */
  avgPointDiff: number | null;
}

/**
 * 共通 (type, className) の event_scores を date＋イベント名で突合し、大会単位に重複排除して
 * 勝敗を集計する（無差別系と個別クラスで同一レースが重複するため date＋正規化名でユニーク化。
 * points はクラス間で同値なので勝敗は不変）。平均得点差も同時に算出。
 */
export function tallyH2H(
  myRankings: RankingAppearance[],
  oppRankings: RankingAppearance[],
): H2HResult {
  const oppByPair = new Map<string, RankingAppearance>();
  for (const r of oppRankings) oppByPair.set(`${r.type}__${r.className}`, r);

  const records = new Map<string, H2HRecord>();
  for (const myR of myRankings) {
    const oppR = oppByPair.get(`${myR.type}__${myR.className}`);
    if (!oppR) continue;
    const discipline: "forest" | "sprint" = myR.type.includes("sprint") ? "sprint" : "forest";

    const oppByDate = new Map<string, EventScore[]>();
    for (const e of oppR.events) {
      if (!e.date) continue;
      const arr = oppByDate.get(e.date);
      if (arr) arr.push(e);
      else oppByDate.set(e.date, [e]);
    }

    for (const myE of myR.events) {
      if (!myE.date) continue;
      const myNorm = stripEventNoise(myE.eventName);
      const key = `${myE.date}:${myNorm}`;
      if (records.has(key)) continue;
      const sameDay = oppByDate.get(myE.date);
      if (!sameDay) continue;
      const oppE =
        sameDay.find((c) => stripEventNoise(c.eventName) === myNorm) ??
        sameDay.find((c) => eventFuzzyMatch(c.eventName, myE.eventName));
      if (!oppE) continue;
      const result: H2HRecord["result"] =
        myE.points > oppE.points ? "win" : myE.points < oppE.points ? "loss" : "draw";
      records.set(key, {
        date: myE.date,
        eventName: myE.eventName,
        myPoints: myE.points,
        oppPoints: oppE.points,
        discipline,
        result,
      });
    }
  }

  const list = [...records.values()].sort((a, b) => b.date.localeCompare(a.date));
  const total: Tally = { win: 0, loss: 0, draw: 0 };
  const forest: Tally = { win: 0, loss: 0, draw: 0 };
  const sprint: Tally = { win: 0, loss: 0, draw: 0 };
  let pointDiffSum = 0;
  for (const r of list) {
    total[r.result]++;
    (r.discipline === "sprint" ? sprint : forest)[r.result]++;
    pointDiffSum += r.myPoints - r.oppPoints;
  }
  const avgPointDiff = list.length > 0 ? Math.round((pointDiffSum / list.length) * 10) / 10 : null;
  return { records: list, total, forest, sprint, avgPointDiff };
}
