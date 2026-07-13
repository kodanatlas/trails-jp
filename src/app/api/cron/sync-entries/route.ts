import { NextResponse } from "next/server";
import { readEventsStrict } from "@/lib/events-store";
import { buildEntryIndex } from "@/lib/entries/build-index";
import { readEntryIndex, writeEntryIndex } from "@/lib/entry-index-store";
import { assessRegression } from "@/lib/entries/index-quality";
import { logCron } from "@/lib/cron-logger";
import { notifyCronWarning } from "@/lib/cron-notifier";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { scrapeDocuments, type JoeDocument } from "@/lib/scraper/documents";

const JOE_BASE_URL = "https://japan-o-entry.com";

// 配車割 Phase 4 相乗りステップの予算・上限。本体を侵さない範囲でだけ働く。
// 本体 overallBudget=35s を使い切る前提で、全体 maxDuration=60s に安全余白(>10s)を残して数秒だけ割く。
const STARTLIST_STEP_BUDGET_MS = 4000;
// 1 リクエストで処理する carpool_events の上限（予算超過の保険）。
const STARTLIST_MAX_EVENTS = 8;
// title にこのいずれかを含む発行書類をスタートリストとみなす。
const STARTLIST_TITLE_HINTS = ["スタート", "スタートリスト", "startlist", "start list"];

/**
 * 配車割 Phase 4 相乗り: startlist_url 未設定の未来大会について発行書類を当たり、
 * スタートリストらしき書類が見つかれば carpool_events.startlist_url を埋める。
 *
 * 完全隔離（例外は呼び出し側で握りつぶす）・残予算内のベストエフォート。
 * change_log は cron 由来のため省略。
 *
 * @returns 実際に startlist_url を更新できた件数。
 */
async function fillStartlistUrls(deadline: number): Promise<number> {
  const today = jstDateStr(0);

  // 対象: joe_event_id 非 null・未来日・startlist_url が null。近い順。
  const { data, error } = await supabaseAdmin
    .from("carpool_events")
    .select("id, joe_event_id, event_date, startlist_url")
    .not("joe_event_id", "is", null)
    .is("startlist_url", null)
    .gte("event_date", today)
    .order("event_date", { ascending: true })
    .limit(STARTLIST_MAX_EVENTS);
  if (error || !data) return 0;

  let updated = 0;
  for (const row of data as Array<{ id: string; joe_event_id: number | null }>) {
    if (Date.now() >= deadline) break; // 予算切れで即中断
    if (row.joe_event_id === null || row.joe_event_id === undefined) continue;

    const joeUrl = `${JOE_BASE_URL}/event/view/${row.joe_event_id}`;
    // 単一の発行書類フェッチがハングして関数全体(maxDuration=60s)を巻き添えにしないよう
    // 明示タイムアウトを付す（残予算との min、下限500ms）。abort/失敗時は空配列が返る。
    const docController = new AbortController();
    const docTimer = setTimeout(
      () => docController.abort(),
      Math.min(4000, Math.max(500, deadline - Date.now())),
    );
    let docs: JoeDocument[] = [];
    try {
      docs = await scrapeDocuments(joeUrl, { signal: docController.signal });
    } finally {
      clearTimeout(docTimer);
    }
    const hit = docs.find((d) =>
      STARTLIST_TITLE_HINTS.some((h) =>
        d.title.toLowerCase().includes(h.toLowerCase()),
      ),
    );
    if (!hit) continue;

    const { error: updError } = await supabaseAdmin
      .from("carpool_events")
      .update({ startlist_url: hit.url })
      .eq("id", row.id);
    if (!updError) updated += 1;
  }
  return updated;
}

// 対象(targets)のうち取得失敗がこの件数以上なら警告（取りこぼし＝選手エントリーの欠落に直結）。
const SCRAPE_SHORTFALL_WARN_THRESHOLD = 5;

// Vercel Cron: 日次 20:23 JST (11:23 UTC) — sync-events(19:07 JST) の後
// 受付中∪締切済かつ未開催の大会のエントリーリストを集計し、選手別インデックスを生成。
// 実行時刻はDB健全な夜帯へ（2026-07-13。旧 04:00 JST は不達窓 00-12 JST に当たり毎回504で凍結）。
// vercel.json: { "path": "/api/cron/sync-entries", "schedule": "23 11 * * *" }

// 関数の最大実行時間（秒）。既定(短い)だと大規模大会(例: 800人超のエントリー表)を
// スクレイプ予算内に取り切れず脱落するため明示的に延長する。
export const maxDuration = 60;

/** スクレイプ対象の上限。在窓(today〜HORIZON)の大会数をカバーできる値にする。 */
const MAX_SCRAPE = 90;
/** 未来の地平線（日数）。これより先の大会は対象外。 */
const HORIZON_DAYS = 120;

/** JST の今日(YYYY-MM-DD) */
function jstDateStr(offsetDays = 0): string {
  const ms = Date.now() + 9 * 3600 * 1000 + offsetDays * 24 * 3600 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  // 索引 write を Vercel maxDuration=60s 内に必ず収めるための絶対デッドラインと、
  // 単一の writeEntryIndex(最大15s)のための予約時間(RESERVE)。劣化判定の read は scrape 前に
  // 先読みしテールから外すので、write 前に残る Storage op は write 1回だけ。2026-07-13 レビュー反映。
  const HANDLER_DEADLINE = start + 50_000;
  const WRITE_RESERVE_MS = 16_000;
  try {
    // fail-closed: Storage から events.json を読めなければ、古いバンドルで作り直さず既存 index を保持。
    const events = await readEventsStrict();
    if (!events) {
      await logCron(
        "sync-entries",
        "error",
        { error: "events_read_failed_failclosed" },
        Date.now() - start,
      );
      await notifyCronWarning(
        "sync-entries",
        "events_read_failed",
        {
          warning: "events_read_failed",
          hint: "Supabase Storage の events.json 読込失敗。古いバンドルで索引を作り直さないため再生成をスキップ（既存索引を保持）。",
        },
        Date.now() - start,
      );
      return NextResponse.json(
        { error: "events read failed; existing index preserved" },
        { status: 500 },
      );
    }

    const today = jstDateStr(0);
    const horizon = jstDateStr(HORIZON_DAYS);

    // 対象: 未開催(date>=today) かつ horizon 以内の全大会。
    // entry_status は信頼できない（アーカイブ由来の大会は "none" になり、受付中でも none のことがある）。
    // 実際にエントリーリストがあるかはスクレイプ結果で判断し、空なら索引に寄与しないだけ。
    let targets = events.filter((e) => e.date >= today && e.date <= horizon);

    // 開催が近い順を優先（キャップで切り捨てるのは遠い未来の大会）
    targets.sort((a, b) => a.date.localeCompare(b.date));

    let deferred = 0;
    if (targets.length > MAX_SCRAPE) {
      deferred = targets.length - MAX_SCRAPE;
      targets = targets.slice(0, MAX_SCRAPE);
    }

    // 劣化判定用の旧 index は scrape の前に先読みする（この Storage read を write のクリティカル
    // テールから外すため）。以降 write 前に残る Storage op は writeEntryIndex(1回)だけになる。
    const prevIndex = await readEntryIndex();

    // 索引 write を60s内に必ず収める: 2つの先読み(readEventsStrict / readEntryIndex 各最大15s)後に
    // scrape 予算を絶対デッドラインから逆算し、単一 write(最大15s)分の余白(RESERVE)を確保する。
    // read が遅いほど scrape が短縮され、write は必ずデッドライン内に始まり60s内に終わる(2026-07-13 レビュー反映)。
    // perEventTimeout は 800人超の大規模エントリー表(数MB級HTML)も取り切れるよう余裕を持たせる。
    const scrapeBudget = Math.max(
      4_000,
      Math.min(35_000, HANDLER_DEADLINE - Date.now() - WRITE_RESERVE_MS),
    );
    const index = await buildEntryIndex(targets, {
      concurrency: 12,
      perEventTimeoutMs: 9000,
      overallBudgetMs: scrapeBudget,
    });

    // 全件失敗（JOYのburst遮断・障害など）のときは既存の良いインデックスを空で上書きしない。
    // 部分成功（scraped < targets）は許容して書き込む（成功分は鮮度を保ち、欠落は scraped で可視化）。
    if (targets.length > 0 && index.scrapedEventCount === 0) {
      await logCron(
        "sync-entries",
        "error",
        { error: "all_scrapes_failed", targets: targets.length },
        Date.now() - start,
      );
      return NextResponse.json(
        { error: "all scrapes failed; existing index preserved" },
        { status: 500 },
      );
    }

    // 劣化上書き防止: 「同一大会のエントリー数」が既存比で大幅減なら上書きしない（低品質 index で良い index を潰さない）。
    // 大会が窓外へ出たことによる athletes 総数の正常減少は per-event 比較で中和される（誤発火しない）。
    // 全滅(scraped=0)は上で別処理済み。ここは「成功扱いだが同一大会で取りこぼした」部分失敗・競合を弾く。
    // prevIndex は scrape 前に先読み済＝ここは in-memory 判定のみ（write テールに Storage read を足さない）。
    const reg = assessRegression(prevIndex, index, {
      minRatio: 0.6,
      floor: 100,
      minCommonEvents: 8,
      minCoverageRatio: 0.7,
      minTargetsForCoverage: 10,
    });
    if (reg.regression) {
      const prevAthletes = prevIndex ? Object.keys(prevIndex.athletes).length : 0;
      const newAthletes = Object.keys(index.athletes).length;
      const detail = {
        mode: reg.mode,
        commonEvents: reg.commonEvents,
        prevEntries: reg.prevBasis,
        nextEntries: reg.nextBasis,
        prevAthletes,
        newAthletes,
        scraped: index.scrapedEventCount,
        targets: targets.length,
      };
      await logCron(
        "sync-entries",
        "error",
        { error: "index_regression_blocked", ...detail },
        Date.now() - start,
      );
      await notifyCronWarning(
        "sync-entries",
        "index_regression_blocked",
        {
          warning: "index_regression_blocked",
          ...detail,
          hint:
            "index 上書きを劣化として拒否。mode=coverage-collapse=対象大会の多くを取り切れず(予算切れ/遮断), " +
            "mode=per-event=同一大会でエントリーが既存比60%未満に減少(JOY/どこオリ遮断やパース不全), " +
            "mode=fallback-count=旧index/共通大会が薄く総数比較にフォールバック。既存 index を保持。",
        },
        Date.now() - start,
      );
      return NextResponse.json(
        { success: false, blocked: "index_regression", mode: reg.mode, prevAthletes, newAthletes },
        { status: 200 },
      );
    }

    // ハード保証: write を始めても60s内に終わらない時間なら fail-closed（既存index保持・backstop再試行）。
    // scrape 予算超過分(中断不可の in-flight cheerio パース末尾など)を含め、write 開始可否をここで最終判定。
    // → 「write 開始時に残 >= WRITE_RESERVE(16s >= 単一op write の最大15s)」を保証＝write は必ず60s内に完了。
    if (Date.now() + WRITE_RESERVE_MS > start + 60_000) {
      await logCron(
        "sync-entries",
        "error",
        { error: "deadline_before_write", elapsed_ms: Date.now() - start, scraped: index.scrapedEventCount },
        Date.now() - start,
      );
      return NextResponse.json(
        { error: "deadline exceeded before write; existing index preserved" },
        { status: 503 },
      );
    }

    await writeEntryIndex(index);

    // 配車割 Phase 4 相乗り（完全隔離）: 本体成功後の残予算でだけ動く。例外・失敗は握りつぶし本体200に影響させない。
    // startlist は非必須なので、write 後に logCron 等の余白(~6s)を残せるときだけ動かす（60s超過→spurious 504 防止）。
    let startlistFilled = 0;
    try {
      const remaining = start + 60_000 - Date.now() - 6_000;
      if (remaining > 1000) {
        const budget = Math.min(STARTLIST_STEP_BUDGET_MS, remaining);
        startlistFilled = await fillStartlistUrls(Date.now() + budget);
      }
    } catch (e) {
      console.error("startlist_url fill step failed (ignored):", e);
    }

    const payload = {
      success: true,
      targets: targets.length,
      scraped: index.scrapedEventCount,
      athletes: Object.keys(index.athletes).length,
      deferred,
      startlist_filled: startlistFilled,
      generated_at: index.generatedAt,
    };
    await logCron("sync-entries", "success", payload, Date.now() - start);

    // 取りこぼし（scraped < targets）が大きいと、その大会のエントリーが選手ページから欠落する。
    // 全失敗は上の error 経路で扱うため、ここは部分取りこぼしの警告（24hデダブ）。
    const shortfall = targets.length - index.scrapedEventCount;
    if (shortfall >= SCRAPE_SHORTFALL_WARN_THRESHOLD) {
      await notifyCronWarning(
        "sync-entries",
        "high_scrape_shortfall",
        {
          warning: "high_scrape_shortfall",
          targets: targets.length,
          scraped: index.scrapedEventCount,
          shortfall,
          deferred,
          hint: "JOY遅延/遮断、または予算(maxDuration/overallBudget)不足の可能性。",
        },
        Date.now() - start,
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Entry index sync failed:", error);
    await logCron("sync-entries", "error", { error: String(error) }, Date.now() - start);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
