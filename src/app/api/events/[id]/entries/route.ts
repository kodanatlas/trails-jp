import { NextResponse } from "next/server";
import { scrapeEntryList } from "@/lib/scraper/entries";

/**
 * GET /api/events/[id]/entries
 * JOY のエントリーリストを所属（クラブ）単位でグループ化して返す。
 * 展開時にオンデマンド取得。上流HTMLは1時間キャッシュ（scrapeEntryList 内）。
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
    const result = await scrapeEntryList(eventId);
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
