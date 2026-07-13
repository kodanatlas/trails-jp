import { NextResponse } from "next/server";
import { matchLapCenterEvents, fetchEventClasses, fetchSplitListDetailed, MANUAL_LC_OVERRIDE_EVENT_IDS } from "@/lib/scraper/lapcenter";
import { buildClassIngest, isSprint, type AthleteLookupEntry, type LegSplitRow, type ScalarRecord } from "@/lib/analysis/leg-ingest";
import { readEvents, writeEvents } from "@/lib/events-store";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readFileSync } from "fs";
import { logCron } from "@/lib/cron-logger";
import { join } from "path";
import { readEntryIndex } from "@/lib/entry-index-store";
import { notifyCronWarning } from "@/lib/cron-notifier";
import { entryIndexAgeHours, isEntryIndexStale } from "@/lib/entries/freshness";

// 索引鮮度ウォッチドッグの閾値（時間）。これより古ければ sync-entries の無音停止を疑い警告。
// sync-entries(20:23 JST) と本ジョブ(21:41 JST)は約1h18差のため、24h で「前日の定期実行スキップ」
// (索引齢≈25h) を検知できる（旧 26h は cron 夜帯移動後に検知漏れ。2026-07-13 レビュー指摘）。
const STALE_INDEX_WARN_HOURS = 24;

// 多クラスの大規模イベントでも壁時計予算内で処理できるよう実行時間上限を延長。
export const maxDuration = 60;

// Vercel Cron: 日次 21:41 JST (12:41 UTC)
// 巡航速度・ミス率スクレイプも毎日実行（壁時計予算内で新しい順に処理）
// 実行時刻はDB健全な夜帯へ（2026-07-13。旧 12:00 JST は不達窓 00-12 JST の末尾で不安定だった）。
// vercel.json: { "path": "/api/cron/sync-lapcenter", "schedule": "41 12 * * *" }

// クラブ正規化・sprint 判定は leg-ingest.ts に移設（backfill スクリプトと共用）

// 1回のCronで処理候補とするイベント数の上限（実処理数は下記の壁時計予算で決まる）
const MAX_RUNNER_EVENTS = 40;
// クラス間スリープ。多クラス大会(インカレ=18クラス等)では 800ms だと睡眠だけで ~14s 消費し
// 1イベントで予算を食い潰して取りこぼす。mulka2 への礼儀を保ちつつ取込スループットを上げるため短縮。
const DELAY_MS = 300;
// 新しいイベントへの着手を打ち切る経過時間（リクエスト開始からの ms）。
// maxDuration=60s に対し、着手後に多クラスイベントが完走できる余裕(~30s)を残す。
const START_EVENT_BEFORE_MS = 30_000;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  try {
    const events = (await readEvents()).map((e) => ({ ...e }));

    // ---- LapCenter イベントマッチング (日次・非致命) ----
    // マッチングは sync-events でも毎日行われ events ストアに永続化される。ここでの
    // mulka2 取得が一時的に失敗(TypeError: fetch failed 等)しても致命とはせず、
    // ストア済みマッチを使って下のスクレイプを必ず続行する（毎日のスクレイプを守る）。
    let matchingResult: Record<string, unknown>;
    try {
      const beforeUnmatched = events.filter((e) => !e.lapcenter_event_id).length;
      const result = await matchLapCenterEvents(events);
      const afterUnmatched = events.filter((e) => !e.lapcenter_event_id).length;
      const newMatches = beforeUnmatched - afterUnmatched;
      if (newMatches > 0) {
        await writeEvents(events);
      }
      matchingResult = {
        new_matches: newMatches,
        total_matched: result.matched,
        total_events: result.total,
        lc_events_fetched: result.lcEventsCount,
      };
    } catch (err) {
      console.error("LC matching failed (non-fatal):", err);
      matchingResult = { error: String(err) };
    }

    // ---- 巡航速度・ミス率スクレイプ (毎日・壁時計予算内で新しい順に処理) ----
    let runnersResult = null;
    try {
      runnersResult = await scrapeRunners(events, start);
    } catch (err) {
      console.error("LC runner scrape failed:", err);
      runnersResult = { error: String(err) };
    }

    const payload = {
      success: true,
      matching: matchingResult,
      runners: runnersResult,
      synced_at: new Date().toISOString(),
    };

    // ---- 索引鮮度ウォッチドッグ (非致命・隔離) ----
    // sync-entries が無音で停止すると entry-index.json が古くなり、最近の申込者が選手ページに出ない。
    // 既存通知は「実行された上での異常」しか拾わないため、実行自体のスキップはここで初めて可視化する。
    // この処理は lapcenter 本処理の結果に一切影響させない（例外は握りつぶしログのみ）。
    try {
      const now = Date.now();
      const index = await readEntryIndex();
      const generatedAt = index?.generatedAt ?? null;
      if (isEntryIndexStale(generatedAt, now, STALE_INDEX_WARN_HOURS)) {
        const ageHours = entryIndexAgeHours(generatedAt, now);
        await notifyCronWarning(
          "sync-entries",
          "stale_entry_index",
          {
            warning: "stale_entry_index",
            generatedAt,
            ageHours,
            threshold_hours: STALE_INDEX_WARN_HOURS,
            hint: "sync-entries が定期実行をスキップした可能性。索引が古いと最近の申込者が選手ページに出ない。",
          },
          0,
        );
      }
    } catch (e) {
      console.error("entry-index freshness check failed (ignored):", e);
    }

    await logCron("sync-lapcenter", "success", payload, Date.now() - start);
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Lap Center sync failed:", error);
    await logCron("sync-lapcenter", "error", { error: String(error) }, Date.now() - start);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}

async function scrapeRunners(
  events: Array<{ joe_event_id: number; name: string; date: string; lapcenter_event_id?: number }>,
  requestStart: number
) {
  // 追跡選手のロード
  const athleteIndex = JSON.parse(
    readFileSync(join(process.cwd(), "public/data/athlete-index.json"), "utf-8")
  );
  const athleteLookup = new Map<string, AthleteLookupEntry>();
  for (const [name, summary] of Object.entries(athleteIndex.athletes) as [string, any][]) {
    athleteLookup.set(name.replace(/\s+/g, ""), { joyName: name, clubs: summary.clubs || [] });
  }

  // 処理済みイベントを取込台帳 lc_leg_events から取得（lc_event_id 基準・~900行）。
  // 旧実装の lc_performances 由来キーは (a) PostgREST max-rows で切り詰められるリスク
  // （reference: Supabase PostgREST max-rows の罠）と (b) 追跡選手ゼロのイベントが
  // 永久に再スクレイプされるバグがあった。台帳は classes>0 のときのみ記帳するので、
  // 結果未掲載イベントの再試行は維持される。ページングは #33 イディオム
  // （空頁のみ終了・実返却行数で前進＝サーバ側キャップに依存しない）。
  const processedLcIds = new Set<number>();
  for (let from = 0; ; ) {
    const { data } = await supabaseAdmin
      .from("lc_leg_events")
      .select("lc_event_id")
      .order("lc_event_id", { ascending: true })
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const row of data) processedLcIds.add(row.lc_event_id);
    from += data.length;
  }

  // 未処理のLC付きイベント。手動マッチ表のイベントを最優先（古くてもキュー先頭へ）→ それ以外は新しい順。
  // スクレイパは壁時計予算で1回数件しか進まず、古い手動マッチ大会(ジュニア/インカレ等)が
  // 新しい順だと永遠にキュー後方で届かないため、明示的に優先して必ず取得させる。
  const isPriority = (e: { lapcenter_event_id?: number }) =>
    e.lapcenter_event_id != null && MANUAL_LC_OVERRIDE_EVENT_IDS.has(e.lapcenter_event_id);
  const lcEvents = events
    .filter((e) => e.lapcenter_event_id && !processedLcIds.has(e.lapcenter_event_id))
    .sort((a, b) => {
      const pa = isPriority(a) ? 1 : 0;
      const pb = isPriority(b) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      // 優先(手動マッチ)同士は古い順=長く取りこぼし続けた古い大会を先に回収する。
      // (新しい順だと最古のインカレミドル等が毎回キュー後方で予算切れに遭い永遠に未取込になる)
      // 非優先は従来どおり新しい順で、直近大会の鮮度を保つ。
      if (pa === 1) return a.date.localeCompare(b.date);
      return b.date.localeCompare(a.date);
    })
    .slice(0, MAX_RUNNER_EVENTS);

  let totalRunners = 0;
  let totalClasses = 0;
  let eventsProcessed = 0;
  let dbInserted = 0;
  let legRowsUpserted = 0;
  let legEventsMarked = 0;
  let stoppedForBudget = false;

  for (const event of lcEvents) {
    // 予算超過後は新しいイベントに着手しない（着手済みイベントは完走させ、イベント単位で保存）
    if (Date.now() - requestStart > START_EVENT_BEFORE_MS) {
      stoppedForBudget = true;
      break;
    }

    const eventId = event.lapcenter_event_id!;
    const eventType: "sprint" | "forest" = isSprint(event.name) ? "sprint" : "forest";

    const classes = await fetchEventClasses(eventId);
    if (classes.length === 0) {
      // 結果未掲載 → 台帳に記帳しない＝次回リトライされる
      eventsProcessed++;
      continue;
    }

    // このイベント分のレコードを集め、イベント単位で即upsert。
    // 途中で関数がタイムアウトしても、完了済みイベントの行は保全される（全損防止）。
    // scalar 版と detailed 版は同一 URL のため、detailed 1回のフェッチから
    // lc_performances 行（従来と同一選別）と lc_leg_splits 行（全走者 per-leg）の両方を得る。
    const eventRecords: ScalarRecord[] = [];
    const eventLegRows: LegSplitRow[] = [];
    let keptClasses = 0;

    for (const cls of classes) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      const detailed = await fetchSplitListDetailed(eventId, cls.classId);
      const { scalarRecords, legRows } = buildClassIngest({
        detailed,
        athleteLookup,
        lcEventId: eventId,
        lcClassId: cls.classId,
        eventDate: event.date,
        eventName: event.name,
        className: cls.className,
        raceType: eventType,
      });
      eventRecords.push(...scalarRecords);
      if (legRows.length > 0) {
        eventLegRows.push(...legRows);
        keptClasses++;
      }
      totalClasses++;
    }

    // イベント単位でバッチ upsert（冪等: athlete_name,event_date,event_name,class_name）
    for (let i = 0; i < eventRecords.length; i += 500) {
      const batch = eventRecords.slice(i, i + 500);
      const { error } = await supabaseAdmin
        .from("lc_performances")
        .upsert(batch, { onConflict: "athlete_name,event_date,event_name,class_name" });
      if (error) {
        console.error("LC DB upsert failed:", error.message);
      } else {
        dbInserted += batch.length;
      }
    }

    // per-leg 行の upsert（配列カラムで行が太いためバッチは 100 行）
    let legUpsertFailed = false;
    for (let i = 0; i < eventLegRows.length; i += 100) {
      const batch = eventLegRows.slice(i, i + 100);
      const { error } = await supabaseAdmin
        .from("lc_leg_splits")
        .upsert(batch, { onConflict: "lc_event_id,lc_class_id,runner_index" });
      if (error) {
        console.error("LC leg upsert failed:", error.message);
        legUpsertFailed = true;
      } else {
        legRowsUpserted += batch.length;
      }
    }

    // 取込台帳への記帳は leg upsert が全て成功したときのみ（失敗イベントは翌日自動リトライ）
    if (!legUpsertFailed) {
      const { error: ledgerError } = await supabaseAdmin.from("lc_leg_events").upsert(
        {
          lc_event_id: eventId,
          event_date: event.date,
          event_name: event.name,
          class_count: classes.length,
          kept_class_count: keptClasses,
          runner_row_count: eventLegRows.length,
          source: "cron",
        },
        { onConflict: "lc_event_id" }
      );
      if (ledgerError) {
        console.error("LC leg ledger upsert failed:", ledgerError.message);
      } else {
        legEventsMarked++;
      }
    }

    totalRunners += eventRecords.length;
    eventsProcessed++;
  }

  return {
    events_processed: eventsProcessed,
    candidate_events: lcEvents.length,
    classes_processed: totalClasses,
    tracked_runners: totalRunners,
    db_inserted: dbInserted,
    leg_rows_upserted: legRowsUpserted,
    leg_events_marked: legEventsMarked,
    stopped_for_budget: stoppedForBudget,
  };
}
