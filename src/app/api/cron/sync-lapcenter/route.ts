import { NextResponse } from "next/server";
import { matchLapCenterEvents } from "@/lib/scraper/lapcenter";
import { readEvents, writeEvents } from "@/lib/events-store";

// Vercel Cron: 日次 12:00 JST (03:00 UTC)
// vercel.json: { "path": "/api/cron/sync-lapcenter", "schedule": "0 3 * * *" }

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Supabase から最新イベントデータを取得
    const events = (await readEvents()).map((e) => ({ ...e }));

    const beforeUnmatched = events.filter(
      (e) => !e.lapcenter_event_id
    ).length;

    const result = await matchLapCenterEvents(events);

    const afterUnmatched = events.filter(
      (e) => !e.lapcenter_event_id
    ).length;
    const newMatches = beforeUnmatched - afterUnmatched;

    // マッチ結果を Supabase に保存
    if (newMatches > 0) {
      await writeEvents(events);
    }

    return NextResponse.json({
      success: true,
      new_matches: newMatches,
      total_matched: result.matched,
      total_events: result.total,
      lc_events_fetched: result.lcEventsCount,
      synced_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Lap Center sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", details: String(error) },
      { status: 500 }
    );
  }
}
