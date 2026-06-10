/**
 * 特定の LapCenter イベントの巡航速度・ミス率を lc_performances に直接 upsert するバックフィル用ワンオフ。
 *
 * sync-lapcenter cron の scrapeRunners と同一の照合/正規化/除外ロジックを流用し、
 * event_name / event_date は JOY events.json の値をそのまま使う（cron 書込と冪等＝重複行を作らない）。
 *
 * 書き込みは Supabase Management API (SUPABASE_ACCESS_TOKEN) 経由で
 * INSERT ... ON CONFLICT DO UPDATE を実行する（SDK の secret key 認証に依存しない）。
 *
 * Usage (env を渡して実行):
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_ACCESS_TOKEN=... \
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/backfill-lapcenter-events.ts
 *
 * 対象イベントは TARGETS を編集する。--dry-run で upsert をスキップ。
 */
import { fetchEventClasses, fetchSplitList } from "../src/lib/scraper/lapcenter";

// --- 対象イベント（LapCenter event id と、events.json と同一の name/date）---
const TARGETS: { id: number; name: string; date: string }[] = [
  { id: 9827, name: "第30回千葉大大会", date: "2026-06-06" }, // Forest / 342名想定
  { id: 9596, name: "千葉大大会", date: "2026-02-21" },       // 第29回午前 / 148名想定
];

const DELAY_MS = 800;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- sync-lapcenter/route.ts と同一のクラブ正規化・種目判定 ---
const SPRINT_KEYWORDS = ["スプリント", "Sprint", "sprint", "パークO", "パーク・オリエンテーリング"];
const CLUB_ALIASES: Record<string, string> = {
  "北大": "北海道大学", "東北大": "東北大学", "東大": "東京大学",
  "名大": "名古屋大学", "京大": "京都大学", "阪大": "大阪大学",
  "九大": "九州大学", "筑波大": "筑波大学", "千葉大": "千葉大学",
  "横国大": "横浜国立大学", "金大": "金沢大学", "新大": "新潟大学",
  "岡大": "岡山大学", "広大": "広島大学", "熊大": "熊本大学",
  "信大": "信州大学", "静大": "静岡大学",
  "大阪": "大阪OLC", "練馬": "練馬OLC", "レオ": "OLCレオ",
  "東京科学大OLT": "東京科学大学",
};
function normalizeClub(club: string): string {
  let s = club;
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  s = s.replace(/olc/gi, "OLC").replace(/olk/gi, "OLK");
  s = s.replace(/OLクラブ/g, "OLC");
  s = s.replace(/OLC$/, "").replace(/OLK$/, "");
  s = s.trim();
  if (CLUB_ALIASES[s]) s = CLUB_ALIASES[s];
  return s;
}
const isSprint = (eventName: string) => SPRINT_KEYWORDS.some((kw) => eventName.includes(kw));

async function loadAthleteLookup(): Promise<Map<string, { joyName: string; clubs: string[] }>> {
  // デプロイ済み cron と同じ選手インデックスを使う（本番 /data/athlete-index.json）。
  const url = "https://trailsjp.vercel.app/data/athlete-index.json";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`athlete-index fetch failed: ${res.status}`);
  const idx = (await res.json()) as { athletes: Record<string, { clubs?: string[] }> };
  const lookup = new Map<string, { joyName: string; clubs: string[] }>();
  for (const [name, summary] of Object.entries(idx.athletes)) {
    lookup.set(name.replace(/\s+/g, ""), { joyName: name, clubs: summary.clubs || [] });
  }
  console.log(`athlete index: ${lookup.size} athletes`);
  return lookup;
}

function sqlLit(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

/** Management API 経由で INSERT ... ON CONFLICT DO UPDATE を実行し、書き込んだ行数を返す。 */
async function mgmtUpsert(
  ref: string,
  token: string,
  rows: Array<{
    athlete_name: string; event_date: string; event_name: string;
    class_name: string; cruising_speed: number; miss_rate: number; race_type: string;
  }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows
    .map((r) =>
      `(${sqlLit(r.athlete_name)},${sqlLit(r.event_date)},${sqlLit(r.event_name)},` +
      `${sqlLit(r.class_name)},${Number(r.cruising_speed)},${Number(r.miss_rate)},${sqlLit(r.race_type)})`,
    )
    .join(",");
  const sql =
    `INSERT INTO public.lc_performances ` +
    `(athlete_name,event_date,event_name,class_name,cruising_speed,miss_rate,race_type) VALUES ${values} ` +
    `ON CONFLICT (athlete_name,event_date,event_name,class_name) DO UPDATE SET ` +
    `cruising_speed=EXCLUDED.cruising_speed, miss_rate=EXCLUDED.miss_rate, race_type=EXCLUDED.race_type`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    console.error("  mgmt upsert error:", res.status, (await res.text()).slice(0, 200));
    return 0;
  }
  return rows.length;
}

async function main() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
  if (!SUPABASE_URL || !ACCESS_TOKEN) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_ACCESS_TOKEN が未設定です");
  }
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  const dryRun = process.argv.includes("--dry-run");

  const athleteLookup = await loadAthleteLookup();

  for (const target of TARGETS) {
    const eventType = isSprint(target.name) ? "sprint" : "forest";
    const classes = await fetchEventClasses(target.id);
    console.log(`\n[event ${target.id}] ${target.date} ${target.name} (${eventType}) — ${classes.length} classes`);
    if (classes.length === 0) continue;

    const records: Array<{
      athlete_name: string; event_date: string; event_name: string;
      class_name: string; cruising_speed: number; miss_rate: number; race_type: string;
    }> = [];

    for (const cls of classes) {
      await sleep(DELAY_MS);
      const runners = await fetchSplitList(target.id, cls.classId);
      let tracked = 0;
      for (const r of runners) {
        const entry = athleteLookup.get(r.name.replace(/\s+/g, ""));
        if (!entry) continue;
        const lcClubs = r.club ? r.club.split("/").map(normalizeClub) : [];
        const joyClubs = entry.clubs.map(normalizeClub);
        const clubMatch =
          lcClubs.length === 0 || joyClubs.length === 0 ||
          lcClubs.some((lc) => joyClubs.some((joy) => lc === joy || lc.includes(joy) || joy.includes(lc)));
        if (!clubMatch) continue;
        if (r.speed === 100 && r.missRate === 0) continue; // 基準ランナー除外
        records.push({
          athlete_name: entry.joyName,
          event_date: target.date,
          event_name: target.name,
          class_name: cls.className,
          cruising_speed: r.speed,
          miss_rate: r.missRate,
          race_type: eventType,
        });
        tracked++;
      }
      if (tracked) console.log(`  ${cls.className}: ${runners.length} runners, ${tracked} tracked`);
    }

    console.log(`[event ${target.id}] tracked records: ${records.length}`);
    if (dryRun) { console.log("  (dry-run: skip upsert)"); continue; }

    let inserted = 0;
    for (let i = 0; i < records.length; i += 200) {
      inserted += await mgmtUpsert(ref, ACCESS_TOKEN, records.slice(i, i + 200));
    }
    console.log(`[event ${target.id}] upserted: ${inserted}`);
  }
  console.log("\n=== backfill done ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
