/**
 * JOA 競技者登録の公開名簿（FY2019〜今年度）から初登録年度を出し、joa_registrations に入れる。
 * 名簿は年度ごとに 1 回ずつ、間隔を空けて取得する。年 1 回（4 月）か、必要なときに手で実行する。
 * 今年度の新規登録はビルド（build-rookie-league）でも毎回足すので、ここは過去の年度を固める用途。
 *
 * Usage:
 *   npx tsx scripts/import-joa-registrations.ts            # supabaseAdmin で upsert
 *   npx tsx scripts/import-joa-registrations.ts --sql      # upsert 用の SQL を標準出力に出す（sbq で流す用）
 */
import { fetchRosterCsv, firstRegistrations, parseRosterCsv, snapshotDate, type RosterRow } from "../src/lib/rookie/joa-roster";
import { fiscalYear, JOA_OLDEST_FY } from "../src/lib/rookie/rules";

const DELAY_MS = 6000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function todayJst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function sqlLiteral(s: string | null): string {
  return s == null ? "null" : `'${s.replace(/'/g, "''")}'`;
}

async function main() {
  const asSql = process.argv.includes("--sql");
  const today = todayJst();
  const currentFy = fiscalYear(today);
  const byFy = new Map<number, RosterRow[]>();
  for (let fy = JOA_OLDEST_FY; fy <= currentFy; fy++) {
    if (byFy.size > 0) await sleep(DELAY_MS);
    const rows = parseRosterCsv(await fetchRosterCsv(snapshotDate(fy, today)));
    if (rows.length < 500) throw new Error(`FY${fy} の名簿が ${rows.length} 件しかありません（取得失敗の疑い）`);
    byFy.set(fy, rows);
    console.error(`FY${fy}: ${rows.length} 件`);
  }
  const firsts = [...firstRegistrations(byFy).values()];
  console.error(`初登録: ${firsts.length} 人`);

  if (asSql) {
    const values = firsts.map((f) => `(${sqlLiteral(f.nameKey)},${f.firstFy},${sqlLiteral(f.firstValidFrom)})`);
    console.log(
      `insert into public.joa_registrations (name_key, first_fy, first_valid_from) values\n${values.join(",\n")}\n` +
        "on conflict (name_key) do update set first_fy = least(joa_registrations.first_fy, excluded.first_fy), " +
        "first_valid_from = case when excluded.first_fy < joa_registrations.first_fy then excluded.first_valid_from else joa_registrations.first_valid_from end, updated_at = now();",
    );
    return;
  }

  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  for (let i = 0; i < firsts.length; i += 500) {
    const batch = firsts.slice(i, i + 500).map((f) => ({ name_key: f.nameKey, first_fy: f.firstFy, first_valid_from: f.firstValidFrom }));
    const { error } = await supabaseAdmin.from("joa_registrations").upsert(batch, { onConflict: "name_key" });
    if (error) throw new Error(`joa_registrations の upsert に失敗しました: ${error.message}`);
  }
  console.error("upsert 完了");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
