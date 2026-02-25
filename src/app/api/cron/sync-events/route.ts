import { NextResponse } from "next/server";
import { scrapeEvents } from "@/lib/scraper/events";

// Vercel Cron: 日次 06:00 JST (21:00 UTC前日)
// vercel.json: { "crons": [{ "path": "/api/cron/sync-events", "schedule": "0 21 * * *" }] }

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
    const events = await scrapeEvents();

    // In production: upsert to Supabase
    // For now: return the scraped data
    return NextResponse.json({
      success: true,
      count: events.length,
      events,
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
