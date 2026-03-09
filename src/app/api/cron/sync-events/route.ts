import { NextResponse } from "next/server";
import { scrapeEvents, scrapeArchive } from "@/lib/scraper/events";
import type { JOEEvent } from "@/lib/scraper/events";
import { readEvents, writeEvents } from "@/lib/events-store";
import { matchLapCenterEvents } from "@/lib/scraper/lapcenter";

// Vercel Cron: 日次 03:00 JST (18:00 UTC)
// イベント同期 + LapCenterマッチング
// 水曜のみ: Vercel再デプロイをトリガー（ビルド時にランキング最新取得）
// vercel.json: { "path": "/api/cron/sync-events", "schedule": "0 18 * * *" }

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

    // 座標補完はスキップ（Hobby 10秒制限対応。新イベントの座標は次回デプロイ時にローカルで補完）
    const coordResult = { enriched: 0, skipped: "timeout_mitigation" };

    // ---- Lap Center マッチング ----
    let lapcenterResult = null;
    try {
      const lcResult = await matchLapCenterEvents(freshEvents);
      lapcenterResult = {
        matched: lcResult.matched,
        total: lcResult.total,
        lc_events: lcResult.lcEventsCount,
      };
    } catch (lcErr) {
      console.error("Lap Center matching failed:", lcErr);
      lapcenterResult = { error: String(lcErr) };
    }

    // Supabaseに保存
    await writeEvents(freshEvents);

    // ---- 水曜のみ: 再デプロイトリガー（火曜のJOYランキング更新を反映） ----
    let deployResult = null;
    const jstDay = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" })
    ).getDay();
    if (jstDay === 3 && process.env.VERCEL_DEPLOY_TOKEN) {
      try {
        const deployRes = await fetch(
          "https://api.vercel.com/v13/deployments",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.VERCEL_DEPLOY_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: "trails_jp",
              project: process.env.VERCEL_PROJECT_ID,
              target: "production",
              gitSource: {
                type: "github",
                org: process.env.GITHUB_ORG,
                repo: process.env.GITHUB_REPO,
                ref: "main",
              },
            }),
          }
        );
        const deployData = await deployRes.json();
        deployResult = {
          triggered: true,
          id: deployData.id,
          status: deployData.readyState,
        };
      } catch (deployErr) {
        console.error("Deploy trigger failed:", deployErr);
        deployResult = { triggered: false, error: String(deployErr) };
      }
    }

    return NextResponse.json({
      success: true,
      events: {
        count: freshEvents.length,
        coordinates: coordResult,
      },
      lapcenter: lapcenterResult,
      deploy: deployResult,
      synced_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Event sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}
