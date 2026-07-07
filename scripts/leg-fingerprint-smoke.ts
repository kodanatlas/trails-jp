/**
 * leg-fingerprint の実データ検証ハーネス（Management API 経由・ローカル REST キー失効対策）。
 * - パックレッグ率で ε の妥当性確認（目標: forest <10% / sprint <15%）
 * - 実測ミス率・ゲート通過選手数・フラグ分布
 * - 感度分析: パック除染 ON/OFF でフラグが激変しないか（Codex レビュー対応）
 * - face validity（既知選手）
 * - 検証済み artifact を public/data/leg-fingerprint.json に書き出し
 *
 * 実行: npx tsx scripts/leg-fingerprint-smoke.ts [--skip-fetch]（/tmp キャッシュ再利用）
 */
import * as fs from "fs";
import * as path from "path";
import {
  buildLegFingerprintIndex,
  detectHomonymKeys,
  type TrackedLegRow,
  type CompanionRow,
  type LegFingerprintIndex,
} from "../src/lib/analysis/leg-fingerprint";

const PROJECT_REF = "mlbyohpbembeoutaakkr";
const CACHE_TRACKED = "/tmp/lf_tracked.json";
const CACHE_COMP = "/tmp/lf_companions.json";

function loadToken(): string {
  const envPath = path.resolve(__dirname, "../.env.local");
  const m = fs.readFileSync(envPath, "utf-8").match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
  if (!m) throw new Error("SUPABASE_ACCESS_TOKEN not found");
  return m[1].trim();
}

async function runSql(token: string, query: string): Promise<unknown[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body)) {
    throw new Error(`SQL failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 150)}`);
  }
  return body;
}

/** id カーソルで全行取得（Management API は1レスポンス上限があるため 5000 行ずつ） */
async function fetchAll<T>(token: string, selectCols: string, where: string): Promise<T[]> {
  const out: T[] = [];
  let lastId = 0;
  for (;;) {
    const rows = (await runSql(
      token,
      `select id, ${selectCols} from lc_leg_splits where ${where} and id > ${lastId} order by id limit 5000`
    )) as ({ id: number } & T)[];
    if (rows.length === 0) break;
    out.push(...rows);
    lastId = rows[rows.length - 1].id;
    process.stdout.write(`\r  fetched ${out.length} rows...`);
  }
  process.stdout.write("\n");
  return out;
}

function summarize(idx: LegFingerprintIndex, label: string) {
  const entries = Object.entries(idx.athletes);
  for (const disc of ["f", "s"] as const) {
    const fps = entries.map(([, a]) => a[disc]).filter((x) => x != null);
    if (fps.length === 0) {
      console.log(`[${label}] ${disc}: 掲載 0`);
      continue;
    }
    const packRate =
      fps.reduce((s, f) => s + f!.legsPack, 0) /
      fps.reduce((s, f) => s + f!.legsValid + f!.legsPack, 0);
    const missRates = fps.map((f) => f!.missRate).sort((a, b) => a - b);
    const flagged = fps.filter((f) => f!.cells.some((c) => c.flag === 1));
    const totalFlags = fps.reduce((s, f) => s + f!.cells.filter((c) => c.flag === 1).length, 0);
    const lag1 = fps.filter((f) => f!.lag1 != null).length;
    console.log(
      `[${label}] ${disc}: 掲載 ${fps.length} 選手 / パックレッグ率 ${(packRate * 100).toFixed(1)}% / ` +
        `ミス率中央値 ${(missRates[Math.floor(missRates.length / 2)] * 100).toFixed(1)}% / ` +
        `フラグ持ち ${flagged.length} (${((flagged.length / fps.length) * 100).toFixed(0)}%)・計 ${totalFlags} セル / lag1 表示 ${lag1}`
    );
  }
}

async function main() {
  const skipFetch = process.argv.includes("--skip-fetch");
  let tracked: TrackedLegRow[];
  let companions: CompanionRow[];
  if (skipFetch && fs.existsSync(CACHE_TRACKED)) {
    tracked = JSON.parse(fs.readFileSync(CACHE_TRACKED, "utf-8"));
    companions = JSON.parse(fs.readFileSync(CACHE_COMP, "utf-8"));
    console.log(`キャッシュ利用: tracked=${tracked.length} companions=${companions.length}`);
  } else {
    const token = loadToken();
    console.log("tracked 行を取得中...");
    tracked = await fetchAll<TrackedLegRow>(
      token,
      "runner_key,event_date,event_name,class_name,club,race_type,rank,speed,start_time,lap_sec,leg_loss_sec,leg_speed,elapsed_sec,lc_event_id,lc_class_id",
      "tracked = true"
    );
    console.log("companion 行を取得中...");
    companions = await fetchAll<CompanionRow>(
      token,
      "lc_event_id,lc_class_id,runner_index,start_time,elapsed_sec",
      "tracked = false"
    );
    fs.writeFileSync(CACHE_TRACKED, JSON.stringify(tracked));
    fs.writeFileSync(CACHE_COMP, JSON.stringify(companions));
  }
  console.log(`入力: tracked=${tracked.length} companions=${companions.length}`);

  // 本番設定
  const idx = { ...buildLegFingerprintIndex(tracked, companions), generatedAt: new Date().toISOString() };
  summarize(idx, "本番設定");

  // 感度分析: パック除染 OFF（ε=0 で無効化）
  const noPack = buildLegFingerprintIndex(tracked, companions, { packEps: { forest: 0, sprint: 0 } });
  summarize(noPack, "除染OFF");
  // フラグ一致率（除染 ON で掲載された選手×種目のセルフラグ比較）
  let agree = 0;
  let total = 0;
  for (const [name, a] of Object.entries(idx.athletes)) {
    for (const disc of ["f", "s"] as const) {
      const on = a[disc];
      const off = noPack.athletes[name]?.[disc];
      if (!on || !off) continue;
      for (let c = 0; c < 9; c++) {
        total++;
        if (on.cells[c].flag === off.cells[c].flag) agree++;
      }
    }
  }
  console.log(`除染 ON/OFF フラグ一致率: ${((agree / total) * 100).toFixed(1)}% (${total} セル)`);

  // Stage 2c: 同姓同名検出の内訳（signal 別・名前の目視・集中度）
  const homonyms = detectHomonymKeys(tracked);
  const classCounts = new Map<string, Map<string, number>>();
  for (const r of tracked) {
    if (r.rank == null) continue;
    const byClass = classCounts.get(r.runner_key) ?? new Map<string, number>();
    const ck = `${r.lc_event_id}:${r.lc_class_id}`;
    byClass.set(ck, (byClass.get(ck) ?? 0) + 1);
    classCounts.set(r.runner_key, byClass);
  }
  const sig1 = [...homonyms].filter((k) =>
    [...(classCounts.get(k)?.values() ?? [])].some((c) => c >= 2)
  );
  console.log(`\n同姓同名検出: 計 ${homonyms.size} 名（signal(i)同クラス重複 ${sig1.length} / signal(ii)同日時間重複 ${homonyms.size - sig1.length}）`);
  const raceCount = new Map<string, number>();
  for (const r of tracked) {
    if (homonyms.has(r.runner_key)) raceCount.set(r.runner_key, (raceCount.get(r.runner_key) ?? 0) + 1);
  }
  console.log(
    "検出名（目視用・レース行数付き）:",
    [...raceCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, c]) => `${k}(${c})`).join(" ")
  );

  // Stage 2c: コホート帯 norms の単調性
  for (const disc of ["f", "s"] as const) {
    const n = idx.cohorts?.[disc];
    if (!n) continue;
    const line = n.bands
      .map((b, i) => {
        const [nn, mm] = b.cells.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1]], [0, 0]);
        const minCell = Math.min(...b.cells.map((c) => c[0]));
        return `帯${i + 1}: ${b.athletes}人/${nn}レッグ/ミス率${((mm / nn) * 100).toFixed(1)}%/最小セルn=${minCell}`;
      })
      .join("  ");
    console.log(`[cohort ${disc}] cuts=${n.cuts.join(",")}  ${line}`);
  }

  // face validity
  for (const name of ["児玉健", "平岡丈"]) {
    const a = idx.athletes[name];
    console.log(`\n${name}: band(f)=${a?.f?.band ?? "-"} band(s)=${a?.s?.band ?? "-"}`, JSON.stringify(a?.f?.cells ?? "（未掲載）").slice(0, 300));
  }

  // artifact
  const outPath = path.resolve(__dirname, "../public/data/leg-fingerprint.json");
  const json = JSON.stringify(idx);
  fs.writeFileSync(outPath, json);
  console.log(`\n書き出し: ${outPath} (${(json.length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
