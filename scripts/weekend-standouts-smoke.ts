/**
 * weekend_standouts RPC の実データスモーク（carpool 教訓のデータ依存ゲート）。
 *
 * ローカルの SUPABASE_SECRET_KEY は失効しているため、Management API の
 * /database/query 経由（SUPABASE_ACCESS_TOKEN）で RPC を直接叩いて結果を目視する。
 *
 * 実行: npx tsx scripts/weekend-standouts-smoke.ts
 */
import * as fs from "fs";
import * as path from "path";
import { recentWeekendCandidates, jstToday, formatDateRangeJp } from "../src/lib/weekend-window";

/** .env.local を簡易パース（dotenv 非依存）。既存の process.env を優先。 */
function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  const p = path.resolve(__dirname, "../.env.local");
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    // 前後のクォートを除去
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

interface StandoutRow {
  athlete_name: string;
  race_type: string;
  target_speed: number;
  baseline_speed: number;
  target_miss: number;
  baseline_miss: number;
  baseline_n: number;
  speed_gain_pct: number;
  miss_drop_pp: number;
  composite: number;
  class_name: string;
  cluster_dates: string[];
}

async function main() {
  const env = loadEnvLocal();
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;

  if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN が未設定です（.env.local も確認）");
  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL が未設定です");

  // https://<ref>.supabase.co から project ref を抽出
  const refMatch = supabaseUrl.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (!refMatch) throw new Error(`project ref を URL から抽出できません: ${supabaseUrl}`);
  const ref = refMatch[1];

  const today = jstToday();
  const candidates = recentWeekendCandidates(today, 35);
  console.log(`今日(JST)=${today}  候補土日祝(${candidates.length}件): ${candidates.join(", ")}`);

  // SQL 補間前に各候補が ISO 日付であることを assert（防御。本番経路ではないが念のため）
  for (const d of candidates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      throw new Error(`不正な候補日（YYYY-MM-DD 以外）: ${JSON.stringify(d)}`);
    }
  }

  // ARRAY['2026-06-13','2026-06-14']::date[] を組み立て
  const arrayLiteral =
    "ARRAY[" + candidates.map((d) => `'${d}'`).join(",") + "]::date[]";
  const sql = `select * from weekend_standouts(${arrayLiteral}, 5, 8);`;

  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Management API query failed: HTTP ${res.status}\n${body}`);
  }

  const rows = (await res.json()) as StandoutRow[];
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log("⚠ 0 行（対象週末のデータが無いか、ゲートで全除外）");
    return;
  }

  const target = rows[0]?.cluster_dates ?? [];
  console.log(`\n対象日: ${formatDateRangeJp(target)} (${target.join(",")}) / ${rows.length} 件\n`);
  rows.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(2)}. ${r.athlete_name}  [${r.class_name}/${r.race_type}]  ` +
        `巡航 ${r.target_speed}←${r.baseline_speed} (+${r.speed_gain_pct}%)  ` +
        `ミス ${r.target_miss}←${r.baseline_miss} (−${r.miss_drop_pp}pp)  ` +
        `n=${r.baseline_n}  composite=${r.composite}`,
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
