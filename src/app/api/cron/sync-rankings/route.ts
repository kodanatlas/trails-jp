import { NextResponse } from "next/server";
import { scrapeAllRankings } from "@/lib/scraper/rankings";

// Vercel Cron: 週次水曜 03:00 JST (火曜 18:00 UTC)
// vercel.json: { "path": "/api/cron/sync-rankings", "schedule": "0 18 * * 2" }

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rankings = await scrapeAllRankings();

    return NextResponse.json({
      success: true,
      rankings_count: rankings.length,
      total_entries: rankings.reduce((sum, r) => sum + r.entries.length, 0),
      rankings: rankings.map((r) => ({
        type: r.ranking_type,
        class: r.class_name,
        entries: r.entries.length,
      })),
      synced_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Ranking sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed", details: String(error) },
      { status: 500 }
    );
  }
}
