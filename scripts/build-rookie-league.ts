/**
 * ルーキーリーグ（B 部門）の静的 JSON を作る（ビルド時に実行）。
 * 出力: public/data/rookie-league.json（今年度と前年度の 2 シーズン）
 *
 * - DB（Supabase）に届かないビルド（Preview・ローカル鍵失効）では、既存の JSON をそのまま残す
 * - 今年度の新規登録は、JOA の公開名簿を 1 回だけ取得して joa_registrations に足す（失敗しても続行）
 * - 計算結果が空なら上書きしない（空上書き防止）
 *
 * ローカルで sbq を使って作る場合: --input <dir>（joa.json / lcfirst.json / season_<fy>.json を置く）
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { normalizeNameKey } from "../src/lib/name-key";
import { fetchRosterCsv, mergeCurrentFy, parseRosterCsv } from "../src/lib/rookie/joa-roster";
import { fiscalYear } from "../src/lib/rookie/rules";
import { buildRookieTable } from "../src/lib/rookie/scoring";
import type { JoaFirstRegistration, RaceResult, RookieLeagueData, RookieSeason } from "../src/lib/rookie/types";

const OUTPUT = join(process.cwd(), "public/data/rookie-league.json");
const ATHLETE_INDEX = join(process.cwd(), "public/data/athlete-index.json");

interface RawRow { e: number; c: number; d: string; en: string; cn: string; n: string; k: string; cl: string | null; r: number | null; s: number | null }
interface Loaders {
  joa(): Promise<Map<string, JoaFirstRegistration>>;
  lcFirst(from: string): Promise<Map<string, string>>;
  season(from: string, to: string, fy: number): Promise<RaceResult[]>;
}

const toResult = (x: RawRow): RaceResult => ({
  lcEventId: x.e, lcClassId: x.c, eventDate: x.d, eventName: x.en, className: x.cn,
  runnerName: x.n, runnerKey: x.k, club: x.cl, rank: x.r, resultSec: x.s,
});

function nowJst(): Date {
  return new Date(Date.now() + 9 * 3600_000);
}

function fileLoaders(dir: string): Loaders {
  const read = <T>(f: string): T => JSON.parse(readFileSync(join(dir, f), "utf-8")) as T;
  return {
    async joa() {
      const rows = read<{ name_key: string; first_fy: number; first_valid_from: string | null }[]>("joa.json");
      return new Map(rows.map((r) => [r.name_key, { nameKey: r.name_key, firstFy: r.first_fy, firstValidFrom: r.first_valid_from }]));
    },
    async lcFirst() {
      return new Map(Object.entries(read<Record<string, string>>("lcfirst.json")));
    },
    async season(_from, _to, fy) {
      const f = `season_${fy}.json`;
      return existsSync(join(dir, f)) ? read<RawRow[]>(f).map(toResult) : [];
    },
  };
}

async function dbLoaders(): Promise<Loaders | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return null;
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  return {
    async joa() {
      // max-rows（1000）で黙って切られないよう、name_key の keyset で空ページまで進める
      const out = new Map<string, JoaFirstRegistration>();
      let after = "";
      for (;;) {
        const { data, error } = await supabaseAdmin
          .from("joa_registrations")
          .select("name_key, first_fy, first_valid_from")
          .gt("name_key", after)
          .order("name_key")
          .limit(1000);
        if (error) throw new Error(`joa_registrations の読み込みに失敗: ${error.message}`);
        if (!data || data.length === 0) break;
        for (const r of data) out.set(r.name_key, { nameKey: r.name_key, firstFy: r.first_fy, firstValidFrom: r.first_valid_from });
        after = data[data.length - 1].name_key;
      }
      return out;
    },
    async lcFirst(from) {
      const { data, error } = await supabaseAdmin.rpc("rookie_lc_first", { p_from: from });
      if (error) throw new Error(`rookie_lc_first に失敗: ${error.message}`);
      return new Map(Object.entries((data ?? {}) as Record<string, string>));
    },
    async season(from, to) {
      const { data, error } = await supabaseAdmin.rpc("rookie_season_results", { p_from: from, p_to: to });
      if (error) throw new Error(`rookie_season_results に失敗: ${error.message}`);
      return ((data ?? []) as RawRow[]).map(toResult);
    },
  };
}

/** 今年度の名簿を取り、まだ DB にいない新規登録を足す（DB へも書く）。失敗しても既存のまま続ける */
async function addCurrentFyRegistrations(joa: Map<string, JoaFirstRegistration>, fy: number, today: string, writeDb: boolean) {
  try {
    const rows = parseRosterCsv(await fetchRosterCsv(today));
    if (rows.length < 500) throw new Error(`今年度の名簿が ${rows.length} 件しかありません`);
    const merged = mergeCurrentFy(joa, fy, rows);
    const added = [...merged.values()].filter((r) => !joa.has(r.nameKey));
    if (writeDb && added.length > 0) {
      const { supabaseAdmin } = await import("../src/lib/supabase-admin");
      const { error } = await supabaseAdmin
        .from("joa_registrations")
        .upsert(added.map((r) => ({ name_key: r.nameKey, first_fy: r.firstFy, first_valid_from: r.firstValidFrom })), { onConflict: "name_key", ignoreDuplicates: true });
      if (error) console.warn(`⚠ joa_registrations への追加に失敗（表は作る）: ${error.message}`);
    }
    console.log(`  JOA 名簿: 今年度 ${rows.length} 件・新規 ${added.length} 人`);
    return merged;
  } catch (e) {
    console.warn(`⚠ JOA 名簿の取得に失敗（DB の初登録だけで作る）: ${e instanceof Error ? e.message : e}`);
    return joa;
  }
}

function linkableKeys(): Set<string> {
  try {
    const idx = JSON.parse(readFileSync(ATHLETE_INDEX, "utf-8")) as { athletes: Record<string, unknown> };
    return new Set(Object.keys(idx.athletes).map(normalizeNameKey));
  } catch {
    return new Set();
  }
}

async function main() {
  const inputIdx = process.argv.indexOf("--input");
  const loaders = inputIdx > 0 ? fileLoaders(process.argv[inputIdx + 1]) : await dbLoaders();
  if (!loaders) {
    console.warn("⚠ Supabase 未設定のため、ルーキーリーグは既存の JSON を使う");
    return;
  }
  const now = nowJst();
  const today = now.toISOString().slice(0, 10);
  const currentFy = fiscalYear(today);
  const fys = [currentFy, currentFy - 1];

  const joaDb = await loaders.joa();
  const joa = inputIdx > 0 ? joaDb : await addCurrentFyRegistrations(joaDb, currentFy, today, true);
  const lcFirst = await loaders.lcFirst(`${currentFy - 1}-04-01`);
  const links = linkableKeys();

  const seasons: RookieSeason[] = [];
  for (const fy of fys) {
    const from = `${fy}-04-01`;
    const to = fy === currentFy ? today : `${fy + 1}-03-31`;
    const results = await loaders.season(from, to, fy);
    const entries = buildRookieTable({ fy, results, joa, lcFirst, linkableKeys: links });
    console.log(`  FY${fy}: 出走 ${results.length} 件 → ルーキー ${entries.length} 人`);
    seasons.push({ fy, label: `${fy}年度`, from, to, entries });
  }
  if (seasons.every((s) => s.entries.length === 0)) {
    console.warn("⚠ ルーキーリーグが空のため上書きしない");
    return;
  }
  const data: RookieLeagueData = {
    generatedAtJst: `${today} ${now.toISOString().slice(11, 16)}`,
    seasons,
  };
  writeFileSync(OUTPUT, JSON.stringify(data));
  console.log(`✓ ${OUTPUT}`);
}

main().catch((e) => {
  // 表が作れなくてもサイトのビルドは止めない（既存の JSON が残る）
  console.warn(`⚠ ルーキーリーグの生成に失敗（既存の JSON を使う）: ${e instanceof Error ? e.message : e}`);
});
