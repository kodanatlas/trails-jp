import { NextResponse } from "next/server";
import { readEvents } from "@/lib/events-store";
import { buildEntryIndex } from "@/lib/entries/build-index";
import { writeEntryIndex } from "@/lib/entry-index-store";
import { logCron } from "@/lib/cron-logger";
import { notifyCronWarning } from "@/lib/cron-notifier";

// 対象(targets)のうち取得失敗がこの件数以上なら警告（取りこぼし＝選手エントリーの欠落に直結）。
const SCRAPE_SHORTFALL_WARN_THRESHOLD = 5;

// Vercel Cron: 日次 04:00 JST (19:00 UTC) — sync-events(03:00 JST) の1時間後
// 受付中∪締切済かつ未開催の大会のエントリーリストを集計し、選手別インデックスを生成。
// vercel.json: { "path": "/api/cron/sync-entries", "schedule": "0 19 * * *" }

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
  try {
    const events = await readEvents();

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

    // maxDuration=60s 内に収める。全体予算は書き込み/直列化の余白を残して 45 秒。
    // perEventTimeout は 800人超の大規模エントリー表(数MB級HTML)も取り切れるよう余裕を持たせる。
    const index = await buildEntryIndex(targets, {
      concurrency: 12,
      perEventTimeoutMs: 9000,
      overallBudgetMs: 45000,
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

    await writeEntryIndex(index);

    const payload = {
      success: true,
      targets: targets.length,
      scraped: index.scrapedEventCount,
      athletes: Object.keys(index.athletes).length,
      deferred,
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
