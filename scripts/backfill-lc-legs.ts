/**
 * lc_leg_splits の履歴 backfill（Stage 2a 運用ツール・再実行可能）。
 *
 * バンドル events.json の LapCenter 突合イベントを新しい順に走査し、
 * per-leg スプリットを Supabase Management API（SQL）で投入する。
 * ローカルの SUPABASE_SECRET_KEY は失効しているため REST は使わない
 * （reference: trails.jp ローカルSupabaseキー失効 / Supabase PostgREST max-rows の罠）。
 *
 * - resume: lc_leg_events 台帳にあるイベントはスキップ（cron と同じ台帳を共有）
 * - lc_performances にも INSERT ... ON CONFLICT DO NOTHING（cron 未到達イベントの
 *   スカラー欠落を防ぐ。既存行は一切変更しない）
 * - 直近イベント（バンドル凍結後）は cron の台帳ベース選択が数日で回収する
 *
 * Usage: npx tsx scripts/backfill-lc-legs.ts [--limit N] [--dry-run]
 */
import * as fs from "fs";
import * as path from "path";
import { fetchEventClasses, fetchSplitListDetailed } from "../src/lib/scraper/lapcenter";
import { buildClassIngest, isSprint, type AthleteLookupEntry, type LegSplitRow, type ScalarRecord } from "../src/lib/analysis/leg-ingest";

const PROJECT_REF = "mlbyohpbembeoutaakkr";
const DELAY_MS = 300; // cron と同じ mulka2 礼儀
const ROWS_PER_STATEMENT = 100;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;

function loadToken(): string {
  const envPath = path.resolve(__dirname, "../.env.local");
  const m = fs.readFileSync(envPath, "utf-8").match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
  if (!m) throw new Error("SUPABASE_ACCESS_TOKEN not found in .env.local");
  return m[1].trim();
}
const token = loadToken();

async function runSql(query: string): Promise<unknown[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), // JSON 経由＝シェル引用符/文字化けの罠を構造的に回避
  });
  const body = await res.json().catch(() => null);
  // 成功 = JSON 配列（0件は []）。オブジェクトが返ったら失敗（supabase-query skill 規約）
  if (!res.ok || !Array.isArray(body)) {
    throw new Error(`SQL failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body;
}

// ---- SQL リテラル（値の埋め込みはこの3関数のみを通す） ----
const lit = (s: string | null | undefined): string =>
  s == null ? "NULL" : `'${s.replace(/\u0000/g, "").replace(/'/g, "''")}'`;
const num = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "NULL" : String(n);
const arr = (xs: (number | null)[], cast: string): string =>
  xs.length ? `ARRAY[${xs.map(num).join(",")}]::${cast}` : `'{}'::${cast}`;

function legRowValues(r: LegSplitRow): string {
  return `(${num(r.lc_event_id)},${num(r.lc_class_id)},${lit(r.event_date)},${lit(r.event_name)},${lit(r.class_name)},${lit(r.race_type)},${num(r.runner_index)},${lit(r.runner_name)},${lit(r.runner_key)},${lit(r.club)},${num(r.rank)},${num(r.result_sec)},${lit(r.start_time)},${num(r.speed)},${num(r.loss_rate)},${num(r.ideal_sec)},${num(r.total_loss_sec)},${arr(r.lap_sec, "integer[]")},${arr(r.lap_rank, "smallint[]")},${arr(r.elapsed_sec, "integer[]")},${arr(r.elapsed_rank, "smallint[]")},${arr(r.leg_loss_sec, "integer[]")},${arr(r.leg_speed, "smallint[]")},${r.tracked ? "true" : "false"})`;
}

async function insertLegRows(rows: LegSplitRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    const batch = rows.slice(i, i + ROWS_PER_STATEMENT);
    const sql =
      `insert into lc_leg_splits (lc_event_id,lc_class_id,event_date,event_name,class_name,race_type,runner_index,runner_name,runner_key,club,rank,result_sec,start_time,speed,loss_rate,ideal_sec,total_loss_sec,lap_sec,lap_rank,elapsed_sec,elapsed_rank,leg_loss_sec,leg_speed,tracked) values ` +
      batch.map(legRowValues).join(",") +
      ` on conflict (lc_event_id,lc_class_id,runner_index) do nothing`;
    await runSql(sql);
  }
}

async function insertScalarRows(rows: ScalarRecord[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const sql =
      `insert into lc_performances (athlete_name,event_date,event_name,class_name,cruising_speed,miss_rate,race_type) values ` +
      batch
        .map(
          (r) =>
            `(${lit(r.athlete_name)},${lit(r.event_date)},${lit(r.event_name)},${lit(r.class_name)},${num(r.cruising_speed)},${num(r.miss_rate)},${lit(r.race_type)})`
        )
        .join(",") +
      ` on conflict (athlete_name,event_date,event_name,class_name) do nothing`;
    await runSql(sql);
  }
}

async function markLedger(e: {
  lcEventId: number; date: string; name: string; classCount: number; keptClassCount: number; rowCount: number;
}): Promise<void> {
  await runSql(
    `insert into lc_leg_events (lc_event_id,event_date,event_name,class_count,kept_class_count,runner_row_count,source) values ` +
      `(${num(e.lcEventId)},${lit(e.date)},${lit(e.name)},${num(e.classCount)},${num(e.keptClassCount)},${num(e.rowCount)},'backfill')` +
      ` on conflict (lc_event_id) do nothing`
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 追跡選手 lookup（cron と同一）
  const athleteIndex = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../public/data/athlete-index.json"), "utf-8")
  );
  const athleteLookup = new Map<string, AthleteLookupEntry>();
  for (const [name, summary] of Object.entries(athleteIndex.athletes) as [string, { clubs?: string[] }][]) {
    athleteLookup.set(name.replace(/\s+/g, ""), { joyName: name, clubs: summary.clubs || [] });
  }

  // LC 突合イベント（バンドル・lc_event_id で一意化・新しい順）
  const events = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../src/data/events.json"), "utf-8")
  ) as { name: string; date: string; lapcenter_event_id?: number }[];
  const byLcId = new Map<number, { name: string; date: string; lcId: number }>();
  for (const e of events) {
    if (e.lapcenter_event_id != null && !byLcId.has(e.lapcenter_event_id)) {
      byLcId.set(e.lapcenter_event_id, { name: e.name, date: e.date, lcId: e.lapcenter_event_id });
    }
  }
  const candidates = [...byLcId.values()].sort((a, b) => b.date.localeCompare(a.date));

  // resume: 台帳の処理済みイベント
  const done = new Set<number>(
    (await runSql("select lc_event_id from lc_leg_events")).map(
      (r) => (r as { lc_event_id: number }).lc_event_id
    )
  );
  const todo = candidates.filter((c) => !done.has(c.lcId)).slice(0, LIMIT);
  console.log(`候補 ${candidates.length} 件・処理済 ${done.size} 件・今回対象 ${todo.length} 件${DRY_RUN ? "（dry-run）" : ""}`);

  let ok = 0;
  let failed = 0;
  let totalRows = 0;
  const failures: string[] = [];

  for (const [i, ev] of todo.entries()) {
    try {
      const classes = await fetchEventClasses(ev.lcId);
      if (classes.length === 0) {
        console.log(`[${i + 1}/${todo.length}] ${ev.date} ${ev.name}: クラス 0（結果未掲載・台帳記帳せず）`);
        continue;
      }
      const raceType: "forest" | "sprint" = isSprint(ev.name) ? "sprint" : "forest";
      const legRows: LegSplitRow[] = [];
      const scalarRows: ScalarRecord[] = [];
      let kept = 0;
      for (const cls of classes) {
        await sleep(DELAY_MS);
        const detailed = await fetchSplitListDetailed(ev.lcId, cls.classId);
        const out = buildClassIngest({
          detailed,
          athleteLookup,
          lcEventId: ev.lcId,
          lcClassId: cls.classId,
          eventDate: ev.date,
          eventName: ev.name,
          className: cls.className,
          raceType,
        });
        scalarRows.push(...out.scalarRecords);
        if (out.legRows.length > 0) {
          legRows.push(...out.legRows);
          kept++;
        }
      }
      if (DRY_RUN) {
        console.log(
          `[${i + 1}/${todo.length}] ${ev.date} ${ev.name}: classes=${classes.length} kept=${kept} legRows=${legRows.length} scalar=${scalarRows.length}（dry-run・書込なし）`
        );
        continue;
      }
      await insertLegRows(legRows);
      await insertScalarRows(scalarRows);
      await markLedger({
        lcEventId: ev.lcId,
        date: ev.date,
        name: ev.name,
        classCount: classes.length,
        keptClassCount: kept,
        rowCount: legRows.length,
      });
      ok++;
      totalRows += legRows.length;
      console.log(
        `[${i + 1}/${todo.length}] ${ev.date} ${ev.name}: classes=${classes.length} kept=${kept} rows=${legRows.length}`
      );
    } catch (err) {
      failed++;
      failures.push(`${ev.date} ${ev.name} (${ev.lcId}): ${String(err).slice(0, 160)}`);
      console.warn(`[${i + 1}/${todo.length}] ⚠ 失敗（続行）: ${ev.date} ${ev.name}: ${String(err).slice(0, 160)}`);
    }
  }

  console.log(`\n完了: ok=${ok} failed=${failed} 総行数=${totalRows}`);
  if (failures.length) {
    console.log("失敗イベント（再実行すれば resume で再試行される）:");
    for (const f of failures) console.log(`  - ${f}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
