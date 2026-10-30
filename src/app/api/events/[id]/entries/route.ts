import { NextResponse } from "next/server";
import { scrapeEntryListByEventId } from "@/lib/scraper/entry-source";

/**
 * 上流取得の打ち切り（ms）。Hobby の Function 上限（10秒）より手前で止め、
 * 504（非JSON）ではなく `error: "fetch_failed"` の JSON を返してクライアントの再試行に乗せる。
 */
const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * GET /api/events/[id]/entries
 * エントリーリストを所属（クラブ）単位でグループ化して返す。
 * eventId のレンジで JOY / どこオリ を自動振り分け。
 * 展開時にオンデマンド取得。上流HTMLは1時間キャッシュ（各スクレイパ内）。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const eventId = parseInt(id, 10);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return NextResponse.json({ error: "Invalid event id" }, { status: 400 });
  }

  try {
    const result = await scrapeEntryListByEventId(eventId, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("Entry list fetch failed:", error);
    return NextResponse.json(
      {
        eventId,
        total: 0,
        teams: [],
        fetchedAt: new Date().toISOString(),
        error: "fetch_failed",
      },
      { status: 200 }
    );
  }
}
