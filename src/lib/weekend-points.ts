/**
 * 上「ポイント上昇度」リストの算出（ビルド時・純 JS）。
 *
 * 直近の土日祝大会で各選手が獲得した JOY イベントポイントが、その選手の同種目・自己平均を
 * どれだけ上回ったか（生 delta）を計算する。`build-analysis-index.ts` から呼ばれ、
 * 結果を `src/data/weekend-points.json` に書き出す。
 */
import {
  recentWeekendCandidates,
  selectLatestCluster,
} from "./weekend-window";

export interface WPInputAthlete {
  key: string;
  club: string;
  events: { date: string; eventName: string; points: number; discipline: "forest" | "sprint" }[];
}

export interface WeekendPointItem {
  name: string;
  key: string;
  club: string;
  discipline: "forest" | "sprint";
  eventName: string; // 採用した（最大ポイントの）大会名
  pRecent: number;
  pAvg: number;
  delta: number;
}

export interface WeekendPointsResult {
  targetDates: string[];
  items: WeekendPointItem[];
}

/** 小数 1 桁に丸める */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 直近土日祝クラスタにおける「自己平均超え」ポイント上昇度を算出。
 * 既定: windowDays=35, minSamples=3, topN=20（先頭5件常時表示＋残りはUIのアコーディオン）。
 */
export function computeWeekendPoints(
  athletes: WPInputAthlete[],
  today: string,
  opts?: { windowDays?: number; minSamples?: number; topN?: number },
): WeekendPointsResult {
  const windowDays = opts?.windowDays ?? 35;
  const minSamples = opts?.minSamples ?? 3;
  const topN = opts?.topN ?? 20;

  // 1. 候補日（直近 windowDays の土日祝）
  const candidateSet = new Set(recentWeekendCandidates(today, windowDays));

  // 2. データの存在する候補日 → 最新クラスタを対象日に
  const presentDates = new Set<string>();
  for (const a of athletes) {
    for (const e of a.events) {
      if (candidateSet.has(e.date)) presentDates.add(e.date);
    }
  }
  const targetDates = selectLatestCluster([...presentDates]);
  if (targetDates.length === 0) return { targetDates: [], items: [] };

  const targetSet = new Set(targetDates);
  const clusterMin = targetDates[0]; // 昇順なので先頭が最小

  // 3. 選手ごと・種目ごとに delta を算出し、選手単位で最良 1 件に絞る
  const items: WeekendPointItem[] = [];
  for (const a of athletes) {
    let best: WeekendPointItem | null = null;
    for (const discipline of ["forest", "sprint"] as const) {
      const sameDisc = a.events.filter((e) => e.discipline === discipline);
      // 対象: 対象日かつ当該種目 → pRecent = points 最大の大会を採用（大会名も保持）
      const recent = sameDisc.filter((e) => targetSet.has(e.date));
      if (recent.length === 0) continue;
      const bestRecent = recent.reduce((m, e) => (e.points > m.points ? e : m));
      const pRecent = bestRecent.points;

      // baseline: 対象クラスタより前（date < clusterMin）かつ当該種目の平均
      const baseEvents = sameDisc.filter((e) => e.date < clusterMin);
      if (baseEvents.length < minSamples) continue;
      const pAvg = baseEvents.reduce((s, e) => s + e.points, 0) / baseEvents.length;

      const delta = round1(pRecent - pAvg);
      if (delta <= 0) continue;

      const item: WeekendPointItem = {
        name: a.key,
        key: a.key,
        club: a.club,
        discipline,
        eventName: bestRecent.eventName,
        pRecent: round1(pRecent),
        pAvg: round1(pAvg),
        delta,
      };
      // 両種目該当時は delta 最大の種目 1 件のみ
      if (!best || item.delta > best.delta) best = item;
    }
    if (best) items.push(best);
  }

  // 4. delta 降順（同値は key 昇順で安定化）、上位 topN
  items.sort((a, b) => b.delta - a.delta || a.key.localeCompare(b.key));
  return { targetDates, items: items.slice(0, topN) };
}
