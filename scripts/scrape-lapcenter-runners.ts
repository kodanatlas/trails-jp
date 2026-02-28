/**
 * LapCenter から全ランナーの巡航速度・ミス率を取得
 * Usage:
 *   npx tsx scripts/scrape-lapcenter-runners.ts           # 全イベント
 *   npx tsx scripts/scrape-lapcenter-runners.ts --limit 5  # 5イベントのみ
 */
import * as fs from "fs";
import * as path from "path";
import { fetchEventClasses, fetchSplitList } from "../src/lib/scraper/lapcenter";

// --- Config ---
const EVENTS_PATH = path.resolve(__dirname, "../src/data/events.json");
const ATHLETES_PATH = path.resolve(__dirname, "../public/data/athlete-index.json");
const OUTPUT_PATH = path.resolve(__dirname, "../public/data/lapcenter-runners.json");
const DELAY_MS = 1200;

// Sprint 判定キーワード
const SPRINT_KEYWORDS = ["スプリント", "Sprint", "sprint", "パークO", "パーク・オリエンテーリング"];

function isSprint(eventName: string): boolean {
  return SPRINT_KEYWORDS.some((kw) => eventName.includes(kw));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** クラブ名エイリアス → 正式名 */
const CLUB_ALIASES: Record<string, string> = {
  // 大学通称
  "北大": "北海道大学", "東北大": "東北大学", "東大": "東京大学",
  "名大": "名古屋大学", "京大": "京都大学", "阪大": "大阪大学",
  "九大": "九州大学", "筑波大": "筑波大学", "千葉大": "千葉大学",
  "横国大": "横浜国立大学", "金大": "金沢大学", "新大": "新潟大学",
  "岡大": "岡山大学", "広大": "広島大学", "熊大": "熊本大学",
  "信大": "信州大学", "静大": "静岡大学",
  // クラブ名寄せ
  "大阪": "大阪OLC", "練馬": "練馬OLC", "レオ": "OLCレオ",
};

/** クラブ名を正規化 (全角→半角, OLC/OLクラブ統一, 大学名統一) */
function normalizeClub(club: string): string {
  let s = club;
  // 全角英数字→半角
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
  // 大文字小文字統一
  s = s.replace(/olc/gi, "OLC").replace(/olk/gi, "OLK");
  // 「OLクラブ」→「OLC」
  s = s.replace(/OLクラブ/g, "OLC");
  // 大学OLC/OLK → 大学 (「東北大OLC」→「東北大」)
  s = s.replace(/OLC$/, "").replace(/OLK$/, "");
  s = s.trim();
  // エイリアス→正式名
  if (CLUB_ALIASES[s]) s = CLUB_ALIASES[s];
  return s;
}

interface LCPerformance {
  d: string;  // date
  e: string;  // event name
  c: string;  // class name
  s: number;  // cruising speed
  m: number;  // miss rate
  t: "forest" | "sprint";
}

async function main() {
  // Parse args
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

  // Load events with LapCenter IDs
  const events: Array<{
    joe_event_id: number;
    name: string;
    date: string;
    lapcenter_event_id?: number;
  }> = JSON.parse(fs.readFileSync(EVENTS_PATH, "utf-8"));
  const lcEvents = events.filter((e) => e.lapcenter_event_id);
  console.log(`LapCenter linked events: ${lcEvents.length}`);

  // Load tracked athletes (JOY rankings)
  const athleteIndex = JSON.parse(fs.readFileSync(ATHLETES_PATH, "utf-8"));
  const trackedNames = new Set<string>(Object.keys(athleteIndex.athletes));
  // Build normalized name → { joyName, clubs } lookup
  // LapCenter: "小牧 弘季" (space), club "筑波大学/ときわ走林会" (slash-separated)
  // JOY:       "小牧弘季" (no space), clubs ["筑波大学", "ときわ走林会"]
  const athleteLookup = new Map<string, { joyName: string; clubs: string[] }>();
  for (const [name, summary] of Object.entries(athleteIndex.athletes) as [string, any][]) {
    const norm = name.replace(/\s+/g, "");
    athleteLookup.set(norm, { joyName: name, clubs: summary.clubs || [] });
  }
  console.log(`Tracked athletes: ${trackedNames.size}`);

  // Load existing data (for resume)
  let existing: Record<string, LCPerformance[]> = {};
  const processedEvents = new Set<number>();
  if (fs.existsSync(OUTPUT_PATH)) {
    const prev = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8"));
    existing = prev.athletes || {};
    // Collect already-processed event dates to detect processed events
    for (const perfs of Object.values(existing) as LCPerformance[][]) {
      for (const p of perfs) {
        // Use date+event as processed key
      }
    }
    console.log(`Existing data: ${Object.keys(existing).length} athletes`);
  }

  // Determine which events to process
  // Collect existing date+event combos to skip already-processed events
  const existingEventKeys = new Set<string>();
  for (const perfs of Object.values(existing) as LCPerformance[][]) {
    for (const p of perfs) {
      existingEventKeys.add(`${p.d}:${p.e}`);
    }
  }

  const toProcess = lcEvents
    .filter((e) => !existingEventKeys.has(`${e.date}:${e.name}`))
    .sort((a, b) => b.date.localeCompare(a.date)) // 新しいイベントから
    .slice(0, limit);

  console.log(`Events to process: ${toProcess.length}\n`);

  let totalRunners = 0;
  let totalClasses = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const event = toProcess[i];
    const eventId = event.lapcenter_event_id!;
    const eventType = isSprint(event.name) ? "sprint" : "forest";

    process.stdout.write(
      `[${i + 1}/${toProcess.length}] ${event.date} ${event.name} (${eventId}) `
    );

    // Fetch class list
    const classes = await fetchEventClasses(eventId);
    if (classes.length === 0) {
      console.log("→ no classes");
      await sleep(DELAY_MS);
      continue;
    }

    let eventRunners = 0;
    for (const cls of classes) {
      await sleep(DELAY_MS);
      const runners = await fetchSplitList(eventId, cls.classId);

      for (const r of runners) {
        // Match by normalized name (remove spaces) + club verification
        const normalized = r.name.replace(/\s+/g, "");
        const entry = athleteLookup.get(normalized);
        if (!entry) continue;

        // Club matching: LC club is slash-separated, JOY clubs is array
        // Normalize both sides (全角→半角, OLクラブ→OLC, 大学OLC→大学)
        const lcClubs = r.club ? r.club.split("/").map((c) => normalizeClub(c)) : [];
        const joyClubs = entry.clubs.map((c) => normalizeClub(c));
        const clubMatch =
          lcClubs.length === 0 ||
          joyClubs.length === 0 ||
          lcClubs.some((lc) => joyClubs.some((joy) => lc === joy || lc.includes(joy) || joy.includes(lc)));

        if (!clubMatch) continue;

        if (!existing[entry.joyName]) existing[entry.joyName] = [];
        existing[entry.joyName].push({
          d: event.date,
          e: event.name,
          c: cls.className,
          s: r.speed,
          m: r.missRate,
          t: eventType,
        });
        eventRunners++;
      }
      totalClasses++;
    }

    totalRunners += eventRunners;
    console.log(
      `→ ${classes.length} classes, ${eventRunners} tracked runners (${eventType})`
    );

    // Save periodically (every 10 events)
    if ((i + 1) % 10 === 0) {
      saveOutput(existing);
      process.stdout.write(`  [saved: ${Object.keys(existing).length} athletes]\n`);
    }
  }

  // Final save
  saveOutput(existing);

  console.log(`\n=== 完了 ===`);
  console.log(`処理イベント: ${toProcess.length}`);
  console.log(`取得クラス: ${totalClasses}`);
  console.log(`追跡選手レコード: ${totalRunners}`);
  console.log(`出力: ${Object.keys(existing).length} athletes → ${OUTPUT_PATH}`);
}

function saveOutput(athletes: Record<string, LCPerformance[]>) {
  // Sort each athlete's performances by date
  for (const perfs of Object.values(athletes)) {
    perfs.sort((a, b) => a.d.localeCompare(b.d));
  }
  const output = {
    athletes,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));
}

main().catch(console.error);
