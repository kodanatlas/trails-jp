import type { AthleteSummary, AthleteProfile, EventScore, RankingAppearance, RankingRef } from "./types";
import type { JOERankingEntry } from "@/lib/scraper/rankings";

/**
 * JOY の event_name ("YYYY-MM-DD\n                大会名") をパース
 */
export function parseEventName(raw: string): { date: string; eventName: string } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+([\s\S]+)$/);
  if (match) return { date: match[1], eventName: match[2].trim() };
  return { date: "", eventName: trimmed };
}

/**
 * AthleteSummary の appearances から、対象ランキングファイルを fetch して
 * 完全な AthleteProfile を構築する
 */
export async function loadAthleteDetail(
  summary: AthleteSummary
): Promise<AthleteProfile> {
  // どのファイルを読む必要があるか (type_className の重複排除)
  const fileKeys = new Set(
    summary.appearances.map((a) => `${a.type}_${a.className}`)
  );

  const rankings: RankingAppearance[] = [];

  await Promise.all(
    [...fileKeys].map(async (key) => {
      try {
        const res = await fetch(`/data/rankings/${key}.json`);
        if (!res.ok) return;
        const entries: JOERankingEntry[] = await res.json();
        const entry = entries.find((e) => e.athlete_name === summary.name);
        if (!entry) return;

        const parts = key.split("_");
        // type は最初の2つ (e.g. "age_forest"), className はそれ以降
        let type: string;
        let className: string;
        if (key.startsWith("elite_forest_")) {
          type = "elite_forest";
          className = key.slice("elite_forest_".length);
        } else if (key.startsWith("elite_sprint_")) {
          type = "elite_sprint";
          className = key.slice("elite_sprint_".length);
        } else if (key.startsWith("age_forest_")) {
          type = "age_forest";
          className = key.slice("age_forest_".length);
        } else if (key.startsWith("age_sprint_")) {
          type = "age_sprint";
          className = key.slice("age_sprint_".length);
        } else {
          type = parts.slice(0, 2).join("_");
          className = parts.slice(2).join("_");
        }

        const events: EventScore[] = entry.event_scores.map((es) => {
          const parsed = parseEventName(es.event_name);
          return { date: parsed.date, eventName: parsed.eventName, points: es.points };
        });

        rankings.push({
          type,
          className,
          rank: entry.rank,
          totalPoints: entry.total_points,
          isActive: entry.is_active,
          events,
        });
      } catch {
        // skip failed fetches
      }
    })
  );

  return { ...summary, rankings };
}

/**
 * 安定性スコア: 変動係数の逆数を 0-100 に変換
 */
export function calcConsistency(events: EventScore[]): number {
  if (events.length < 2) return 0;
  const points = events.map((e) => e.points);
  const mean = points.reduce((a, b) => a + b, 0) / points.length;
  if (mean === 0) return 0;
  const variance = points.reduce((sum, p) => sum + (p - mean) ** 2, 0) / points.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.round(Math.max(0, Math.min(100, (1 - cv / 0.3) * 100)));
}

/**
 * 最近の調子: 直近3大会の平均 vs 全体平均 (%)
 */
export function calcRecentForm(events: EventScore[]): number {
  if (events.length < 2) return 0;
  const sorted = [...events]
    .filter((e) => e.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (sorted.length < 2) return 0;
  const recent = sorted.slice(0, 3);
  const recentAvg = recent.reduce((s, e) => s + e.points, 0) / recent.length;
  const allAvg = sorted.reduce((s, e) => s + e.points, 0) / sorted.length;
  if (allAvg === 0) return 0;
  return Math.round(((recentAvg - allAvg) / allAvg) * 100);
}

/**
 * 全イベントスコアを日付順にまとめる（カテゴリ横断、重複排除）
 */
export function getAllEvents(profile: AthleteProfile): EventScore[] {
  const map = new Map<string, EventScore>();
  for (const r of profile.rankings) {
    for (const e of r.events) {
      if (!e.date) continue;
      const key = `${e.date}:${e.eventName}`;
      const existing = map.get(key);
      if (!existing || e.points > existing.points) {
        map.set(key, e);
      }
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 特性判定ラベル
 */
export function typeLabel(type: AthleteSummary["type"]): string {
  switch (type) {
    case "sprinter": return "スプリンター";
    case "forester": return "フォレスター";
    case "allrounder": return "オールラウンダー";
    default: return "—";
  }
}

/**
 * ランキングカテゴリの日本語ラベル
 */
export function rankingTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    elite_forest: "エリートフォレスト",
    elite_sprint: "エリートスプリント",
    age_forest: "年齢別フォレスト",
    age_sprint: "年齢別スプリント",
  };
  return labels[type] ?? type;
}

/**
 * forest / sprint の最高ランクをそれぞれ取得
 */
export function getBestRanks(appearances: RankingRef[]) {
  let forestBest = Infinity;
  let sprintBest = Infinity;
  let forestPoints = 0;
  let sprintPoints = 0;

  for (const r of appearances) {
    if (r.type.includes("forest")) {
      if (r.rank < forestBest) {
        forestBest = r.rank;
        forestPoints = r.totalPoints;
      }
    }
    if (r.type.includes("sprint")) {
      if (r.rank < sprintBest) {
        sprintBest = r.rank;
        sprintPoints = r.totalPoints;
      }
    }
  }

  return {
    forestRank: forestBest === Infinity ? null : forestBest,
    forestPoints,
    sprintRank: sprintBest === Infinity ? null : sprintBest,
    sprintPoints,
  };
}
