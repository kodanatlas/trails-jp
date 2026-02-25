import { NextResponse } from "next/server";
import { scrapeEvents, enrichEventsWithCoordinates } from "@/lib/scraper/events";
import type { JOEEvent } from "@/lib/scraper/events";
import eventsJson from "@/data/events.json";

// Vercel Cron: 日次 03:00 JST (18:00 UTC前日)
// vercel.json: { "path": "/api/cron/sync-events", "schedule": "0 18 * * *" }

export async function GET(request: Request) {
  // Verify cron secret in production
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const freshEvents = await scrapeEvents();

    // 既存データから座標・Lap Center情報を引き継ぎ
    const stored = new Map(
      (eventsJson as JOEEvent[]).map((e) => [e.joe_event_id, e])
    );

    for (const event of freshEvents) {
      const existing = stored.get(event.joe_event_id);
      if (existing) {
        event.lat = existing.lat;
        event.lng = existing.lng;
        event.lapcenter_event_id = existing.lapcenter_event_id;
        event.lapcenter_url = existing.lapcenter_url;
        event.recently_updated = existing.recently_updated;
        event.update_label = existing.update_label;
      }
    }

    // 座標未取得のイベントをバッチ処理（50件/回、500ms間隔）
    const coordResult = await enrichEventsWithCoordinates(freshEvents, 50, 500);

    // In production: upsert to Supabase / write to file
    return NextResponse.json({
      success: true,
      count: freshEvents.length,
      coordinates: coordResult,
      events: freshEvents,
      synced_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Event sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", details: String(error) },
      { status: 500 }
    );
  }
}
