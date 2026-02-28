import { NextResponse } from "next/server";
import { scrapeEvents, scrapeArchive, enrichEventsWithCoordinates } from "@/lib/scraper/events";
import type { JOEEvent } from "@/lib/scraper/events";
import { readEvents, writeEvents } from "@/lib/events-store";
import { scrapeAllRankings } from "@/lib/scraper/rankings";

// Vercel Cron: 日次 03:00 JST (18:00 UTC)
// 水曜日はランキング同期も実行
// vercel.json: { "path": "/api/cron/sync-events", "schedule": "0 18 * * *" }

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // ---- イベント同期 ----
    // トップページ + 今年 + 過去年のアーカイブを取得
    const currentYear = new Date().getFullYear();
    const yearsToFetch = new URL(request.url).searchParams.get("years");
    const archiveYears = yearsToFetch
      ? yearsToFetch.split(",").map(Number)
      : [currentYear, currentYear - 1];

    const [topEvents, ...archiveResults] = await Promise.all([
      scrapeEvents(),
      ...archiveYears.map((y) => scrapeArchive(y)),
    ]);

    // 全イベントをマージ（ID重複排除、トップページ優先）
    const eventMap = new Map<number, JOEEvent>();
    for (const events of archiveResults) {
      for (const e of events) eventMap.set(e.joe_event_id, e);
    }
    for (const e of topEvents) eventMap.set(e.joe_event_id, e);

    // 既存データから座標・Lap Center情報を引き継ぎ
    const stored = new Map(
      (await readEvents()).map((e) => [e.joe_event_id, e])
    );

    // 既存の過去データも保持（アーカイブに載らなくなった古いイベント）
    for (const [id, e] of stored) {
      if (!eventMap.has(id)) eventMap.set(id, e);
    }

    const freshEvents = [...eventMap.values()];
    for (const event of freshEvents) {
      const existing = stored.get(event.joe_event_id);
      if (existing) {
        // 日付が空の場合は既存データから復元
        if (!event.date && existing.date) {
          event.date = existing.date;
          event.end_date = existing.end_date;
        }
        event.lat = existing.lat;
        event.lng = existing.lng;
        event.lapcenter_event_id = existing.lapcenter_event_id;
        event.lapcenter_url = existing.lapcenter_url;
        event.recently_updated = existing.recently_updated;
        event.update_label = existing.update_label;
      }
    }

    // 日付順ソート
    freshEvents.sort((a, b) => a.date.localeCompare(b.date));

    // 座標未取得のイベントをバッチ処理（50件/回、500ms間隔）
    const coordResult = await enrichEventsWithCoordinates(freshEvents, 50, 500);

    // Supabaseに保存
    await writeEvents(freshEvents);

    // ---- ランキング同期（水曜のみ） ----
    let rankingsResult = null;
    const jstHour = new Date().getUTCHours() + 9;
    const jstDay = new Date(
      Date.now() + 9 * 60 * 60 * 1000
    ).getUTCDay();

    if (jstDay === 3) {
      // 水曜日
      try {
        const rankings = await scrapeAllRankings();
        rankingsResult = {
          rankings_count: rankings.length,
          total_entries: rankings.reduce(
            (sum, r) => sum + r.entries.length,
            0
          ),
        };
      } catch (rankErr) {
        console.error("Rankings sync failed:", rankErr);
        rankingsResult = { error: String(rankErr) };
      }
    }

    return NextResponse.json({
      success: true,
      events: {
        count: freshEvents.length,
        coordinates: coordResult,
      },
      rankings: rankingsResult,
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
