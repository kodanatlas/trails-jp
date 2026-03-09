/**
 * 既存の静的JSONからSupabase DBにデータをインポートするスクリプト。
 * Phase 1a: 初回データ投入用（1回だけ実行）。
 *
 * 前提: docs/sql/002_analysis_tables.sql がSupabaseで実行済みであること。
 *
 * Usage: npx tsx scripts/import-to-db.ts
 */
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

// .env.local を手動読み込み（dotenv不要）
const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !secretKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, secretKey);

const DATA_DIR = path.resolve(__dirname, "../public/data");

interface AthleteSummary {
  name: string;
  clubs: string[];
  appearances: { type: string; className: string; rank: number; totalPoints: number; isActive: boolean }[];
  bestRank: number;
  avgTotalPoints: number;
  forestCount: number;
  sprintCount: number;
  type: string;
  recentForm: number;
}

interface LCPerformance {
  d: string;
  e: string;
  c: string;
  s: number;
  m: number;
  t: "forest" | "sprint";
}

async function importAthletes() {
  console.log("--- Importing athletes ---");
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "athlete-index.json"), "utf-8"));
  const athletes: AthleteSummary[] = Object.values(raw.athletes);
  console.log(`Found ${athletes.length} athletes`);

  // バッチ挿入（100件ずつ）
  const BATCH = 100;
  let inserted = 0;

  for (let i = 0; i < athletes.length; i += BATCH) {
    const batch = athletes.slice(i, i + BATCH);
    const rows = batch.map((a) => ({
      name: a.name,
      clubs: a.clubs,
      best_rank: a.bestRank,
      avg_total_points: a.avgTotalPoints,
      forest_count: a.forestCount,
      sprint_count: a.sprintCount,
      athlete_type: a.type,
      recent_form: a.recentForm,
    }));

    const { error } = await supabase
      .from("athletes")
      .upsert(rows, { onConflict: "name" });

    if (error) {
      console.error(`Batch ${i}-${i + BATCH} failed:`, error.message);
    } else {
      inserted += batch.length;
    }
  }
  console.log(`Inserted ${inserted} athletes`);

  // appearances の挿入
  console.log("--- Importing athlete appearances ---");
  // まず athlete id を取得
  const { data: dbAthletes } = await supabase
    .from("athletes")
    .select("id, name");

  if (!dbAthletes) {
    console.error("Failed to fetch athlete IDs");
    return;
  }

  const nameToId = new Map(dbAthletes.map((a) => [a.name, a.id]));
  let appInserted = 0;

  for (let i = 0; i < athletes.length; i += BATCH) {
    const batch = athletes.slice(i, i + BATCH);
    const rows: Array<{
      athlete_id: number;
      ranking_type: string;
      class_name: string;
      rank: number;
      total_points: number;
      is_active: boolean;
    }> = [];

    for (const a of batch) {
      const id = nameToId.get(a.name);
      if (!id) continue;
      for (const app of a.appearances) {
        rows.push({
          athlete_id: id,
          ranking_type: app.type,
          class_name: app.className,
          rank: app.rank,
          total_points: app.totalPoints,
          is_active: app.isActive,
        });
      }
    }

    if (rows.length === 0) continue;

    // バッチが大きくなりすぎないよう分割
    for (let j = 0; j < rows.length; j += 500) {
      const subBatch = rows.slice(j, j + 500);
      const { error } = await supabase
        .from("athlete_appearances")
        .upsert(subBatch, { onConflict: "athlete_id,ranking_type,class_name" });

      if (error) {
        console.error(`Appearances batch failed:`, error.message);
      } else {
        appInserted += subBatch.length;
      }
    }
  }
  console.log(`Inserted ${appInserted} appearances`);
}

async function importLCPerformances() {
  console.log("\n--- Importing LC performances ---");
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "lapcenter-runners.json"), "utf-8"));
  const athletes: Record<string, LCPerformance[]> = raw.athletes;
  const names = Object.keys(athletes);
  console.log(`Found ${names.length} athletes with LC data`);

  const BATCH = 500;
  let inserted = 0;
  let duplicatesRemoved = 0;
  let total = 0;

  for (const name of names) {
    const perfs = athletes[name];
    total += perfs.length;

    // バッチ内重複を排除（同一キーの最後のレコードを採用）
    const deduped = new Map<string, typeof rows[0]>();
    const rows = perfs.map((p) => ({
      athlete_name: name,
      event_date: p.d,
      event_name: p.e,
      class_name: p.c,
      cruising_speed: p.s,
      miss_rate: p.m,
      race_type: p.t,
    }));
    for (const row of rows) {
      const key = `${row.athlete_name}|${row.event_date}|${row.event_name}|${row.class_name}`;
      deduped.set(key, row);
    }
    const uniqueRows = [...deduped.values()];
    duplicatesRemoved += rows.length - uniqueRows.length;

    for (let i = 0; i < uniqueRows.length; i += BATCH) {
      const batch = uniqueRows.slice(i, i + BATCH);
      const { error } = await supabase
        .from("lc_performances")
        .upsert(batch, { onConflict: "athlete_name,event_date,event_name,class_name" });

      if (error) {
        console.error(`LC batch for ${name} failed:`, error.message);
      } else {
        inserted += batch.length;
      }
    }
  }
  console.log(`Inserted ${inserted}/${total} LC performance records (${duplicatesRemoved} duplicates removed)`);
}

async function main() {
  console.log("=== DB Import Start ===\n");
  await importAthletes();
  await importLCPerformances();
  console.log("\n=== DB Import Complete ===");
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
