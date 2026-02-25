import * as cheerio from "cheerio";

export interface JOERankingEntry {
  rank: number;
  athlete_name: string;
  club: string;
  total_points: number;
  is_active: boolean;
  event_scores: { event_name: string; points: number }[];
}

export interface JOERanking {
  ranking_type: string;
  class_name: string;
  entries: JOERankingEntry[];
  synced_at: string;
}

const BASE_URL = "https://japan-o-entry.com/ranking/ranking/ranking_index";

// 年齢別クラス共通定義（無差別～W90）
const AGE_CLASSES = [
  "無差別", "M15", "M18", "M20", "M21", "M25", "M30", "M35", "M40", "M45",
  "M50", "M55", "M60", "M65", "M70", "M75", "M80", "M85", "M90",
  "女子無差別", "W15", "W18", "W20", "W21", "W25", "W30", "W35", "W40", "W45",
  "W50", "W55", "W60", "W65", "W70", "W75", "W80", "W85", "W90",
] as const;

// 全ランキングカテゴリ定義
export const RANKING_CONFIGS = [
  {
    type: "elite_forest", label: "エリートフォレスト", typeId: 5,
    classes: [
      { id: 39, name: "M21E", label: "男子" },
      { id: 46, name: "W21E", label: "女子" },
    ],
  },
  {
    type: "elite_sprint", label: "エリートスプリント", typeId: 17,
    classes: [
      { id: 85, name: "S_Open", label: "総合" },
      { id: 86, name: "S_W", label: "女子" },
    ],
  },
  {
    type: "age_forest", label: "年齢別フォレスト", typeId: 1,
    classes: AGE_CLASSES.map((name, i) => ({ id: i + 1, name, label: name })),
  },
  {
    type: "age_sprint", label: "年齢別スプリント", typeId: 15,
    classes: AGE_CLASSES.map((name, i) => ({ id: i + 47, name: "S_" + name, label: name })),
  },
];

/**
 * 特定のランキングカテゴリ・クラスをスクレイピング
 */
export async function scrapeRanking(
  typeId: number,
  classId: number
): Promise<JOERankingEntry[]> {
  const url = `${BASE_URL}/${typeId}/${classId}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "trails.jp/1.0 (ranking sync)" },
    next: { revalidate: 0 },
  });
  if (!res.ok) return [];
  const html = await res.text();
  return parseRankingTable(html);
}

function parseRankingTable(html: string): JOERankingEntry[] {
  const $ = cheerio.load(html);
  const entries: JOERankingEntry[] = [];

  const eventHeaders: string[] = [];
  $("table thead th, table tr:first-child th").each((i, th) => {
    if (i > 3) eventHeaders.push($(th).text().trim());
  });

  $("table tbody tr").each((_, row) => {
    const $row = $(row);
    const cells = $row.find("td");
    if (cells.length < 4) return;

    const rank = parseInt(cells.eq(0).text().trim(), 10);
    if (isNaN(rank)) return;

    const athlete_name = cells.eq(1).text().trim();
    if (!athlete_name) return;

    const club = cells.eq(2).text().trim();
    const total_points = parseFloat(cells.eq(3).text().trim()) || 0;
    const rowClass = $row.attr("class") ?? "";
    const is_active = !rowClass.includes("out_ranker");

    const event_scores: { event_name: string; points: number }[] = [];
    cells.each((i, cell) => {
      if (i > 3 && eventHeaders[i - 4]) {
        const pts = parseFloat($(cell).text().trim());
        if (!isNaN(pts) && pts > 0) {
          event_scores.push({ event_name: eventHeaders[i - 4], points: pts });
        }
      }
    });

    entries.push({ rank, athlete_name, club, total_points, is_active, event_scores });
  });

  return entries;
}

/**
 * 全ランキングを一括取得
 */
export async function scrapeAllRankings(): Promise<JOERanking[]> {
  const results: JOERanking[] = [];
  const now = new Date().toISOString();

  for (const config of RANKING_CONFIGS) {
    for (const cls of config.classes) {
      try {
        const entries = await scrapeRanking(config.typeId, cls.id);
        if (entries.length > 0) {
          results.push({
            ranking_type: config.type,
            class_name: cls.name,
            entries,
            synced_at: now,
          });
        }
        await new Promise((r) => setTimeout(r, 1200));
      } catch (e) {
        console.error(`Failed to scrape ${config.type}/${cls.name}:`, e);
      }
    }
  }

  return results;
}
