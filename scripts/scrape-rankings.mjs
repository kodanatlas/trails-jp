/**
 * japan-o-entry.com からランキングデータを全ページ取得して JSON に保存
 * 実行: node scripts/scrape-rankings.mjs
 */
import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = "https://japan-o-entry.com/ranking/ranking/ranking_index";

// 全カテゴリ共通のクラス名配列（無差別～W90）
const AGE_CLASSES = [
  "無差別", "M15", "M18", "M20", "M21", "M25", "M30", "M35", "M40", "M45",
  "M50", "M55", "M60", "M65", "M70", "M75", "M80", "M85", "M90",
  "女子無差別", "W15", "W18", "W20", "W21", "W25", "W30", "W35", "W40", "W45",
  "W50", "W55", "W60", "W65", "W70", "W75", "W80", "W85", "W90",
];

const RANKING_CONFIGS = [
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

function parseRankingPage(html) {
  const $ = cheerio.load(html);
  const entries = [];

  const eventHeaders = [];
  $("table thead tr th, table tr:first-child th").each((i, th) => {
    const text = $(th).text().trim();
    if (i > 3 && text) eventHeaders.push(text);
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
    const rowClass = $row.attr("class") || "";
    const is_active = !rowClass.includes("out_ranker");

    const event_scores = [];
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

async function fetchPage(url) {
  const res = await fetch(url, { headers: { "User-Agent": "trails.jp/1.0 (ranking sync)" } });
  if (!res.ok) return null;
  return await res.text();
}

async function fetchAllPages(typeId, classId, label) {
  const baseUrl = `${BASE_URL}/${typeId}/${classId}`;
  const allEntries = [];
  const seenKeys = new Set();

  for (let page = 0; ; page++) {
    const pageUrl = page === 0 ? baseUrl : `${baseUrl}/${page}`;
    if (page > 0) await new Promise(r => setTimeout(r, 1200));

    const html = await fetchPage(pageUrl);
    if (!html) break;

    const entries = parseRankingPage(html);
    if (entries.length === 0) break;

    let added = 0;
    for (const entry of entries) {
      const key = `${entry.rank}:${entry.athlete_name}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allEntries.push(entry);
        added++;
      }
    }
    process.stdout.write(page === 0 ? `${added}` : `+${added}`);
  }

  return allEntries;
}

async function main() {
  console.log("japan-o-entry.com ランキング全カテゴリ取得開始\n");

  const allData = {};
  let totalAthletes = 0;
  let totalCategories = 0;

  for (const config of RANKING_CONFIGS) {
    console.log(`\n[${config.label}] (typeId=${config.typeId}, ${config.classes.length}クラス)`);

    for (const cls of config.classes) {
      const key = `${config.type}:${cls.name}`;
      process.stdout.write(`  ${cls.label}: `);

      const entries = await fetchAllPages(config.typeId, cls.id, cls.label);

      if (entries.length > 0) {
        allData[key] = entries;
        totalAthletes += entries.length;
        totalCategories++;
        console.log(` → ${entries.length}人`);
      } else {
        console.log(` → 0人 (skip)`);
      }

      await new Promise(r => setTimeout(r, 1200));
    }
  }

  // カテゴリ別 JSON を public/ に保存
  const pubDir = join(__dirname, "..", "public", "data", "rankings");
  mkdirSync(pubDir, { recursive: true });

  for (const [key, entries] of Object.entries(allData)) {
    const filename = key.replace(":", "_") + ".json";
    writeFileSync(join(pubDir, filename), JSON.stringify(entries));
  }

  // 一括 JSON を src/data/ に保存（バックアップ用）
  const srcDir = join(__dirname, "..", "src", "data");
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, "rankings.json"), JSON.stringify(allData, null, 2));

  // RANKING_CONFIGS を保存（アプリから参照）
  writeFileSync(join(srcDir, "ranking-configs.json"), JSON.stringify(RANKING_CONFIGS, null, 2));

  // サマリー
  console.log("\n\n=== サマリー ===");
  for (const config of RANKING_CONFIGS) {
    const configEntries = Object.entries(allData).filter(([k]) => k.startsWith(config.type + ":"));
    const count = configEntries.reduce((s, [, v]) => s + v.length, 0);
    console.log(`${config.label}: ${configEntries.length}クラス / ${count}人`);
  }
  console.log(`\n合計: ${totalAthletes}人 / ${totalCategories}カテゴリ`);
}

main().catch(console.error);
