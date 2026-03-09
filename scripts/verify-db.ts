/**
 * DB投入結果の検証スクリプト
 * Usage: npx tsx scripts/verify-db.ts
 */
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);

async function main() {
  const { count: aC } = await sb.from("athletes").select("*", { count: "exact", head: true });
  const { count: apC } = await sb.from("athlete_appearances").select("*", { count: "exact", head: true });
  const { count: lcC } = await sb.from("lc_performances").select("*", { count: "exact", head: true });

  console.log(`athletes: ${aC}`);
  console.log(`appearances: ${apC}`);
  console.log(`lc_performances: ${lcC}`);

  // 個別選手のLCデータ確認
  for (const name of ["南河駿", "児玉健"]) {
    const { data } = await sb.from("lc_performances").select("*").eq("athlete_name", name);
    console.log(`\n${name} LC records: ${data?.length}`);
  }
}

main().catch(console.error);
