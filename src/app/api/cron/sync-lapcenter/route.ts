import { NextResponse } from "next/server";
import { matchLapCenterEvents } from "@/lib/scraper/lapcenter";
import eventsJson from "@/data/events.json";
import type { JOEEvent } from "@/lib/scraper/events";

// Vercel Cron: 日次 04:00 JST (19:00 UTC前日) — Hobbyプラン制約
// Pro化後は "*/15 * * * *" に変更可能
// vercel.json: { "path": "/api/cron/sync-lapcenter", "schedule": "0 19 * * *" }

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Work with a copy of the events data
    const events = (eventsJson as JOEEvent[]).map((e) => ({ ...e }));

    // Count events without Lap Center links before matching
    const beforeUnmatched = events.filter((e) => !e.lapcenter_event_id).length;

    const result = await matchLapCenterEvents(events);

    const afterUnmatched = events.filter((e) => !e.lapcenter_event_id).length;
    const newMatches = beforeUnmatched - afterUnmatched;

    // In production: persist updated events to database / write to file
    // For now: return the result summary
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
