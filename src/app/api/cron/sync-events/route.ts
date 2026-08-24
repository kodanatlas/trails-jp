import { NextResponse } from "next/server";
import { scrapeEvents, scrapeArchive } from "@/lib/scraper/events";
import type { JOEEvent } from "@/lib/scraper/events";
import { scrapeDokoriEvents } from "@/lib/scraper/dokori";
import { readEvents, writeEvents } from "@/lib/events-store";
import { matchLapCenterEvents } from "@/lib/scraper/lapcenter";
import { logCron } from "@/lib/cron-logger";
import { notifyCronWarning } from "@/lib/cron-notifier";

// トップページ取得分のうち日付が空の件数がこの値以上なら警告（JOY のフォーマット変更検知）。
// 正常時はほぼ 0。年なし表記の補完が効かなくなる等の異常を無音にしないためのカナリア。
const EMPTY_DATE_WARN_THRESHOLD = 5;

// Vercel Cron: 日次 19:07 JST (10:07 UTC)
// イベント同期 + LapCenterマッチング
// 水曜のみ: Vercel再デプロイをトリガー（ビルド時にランキング最新取得）
// 実行時刻はDBデータ面が健全な夜帯に配置（2026-07-13。旧 03:00 JST は不達の窓 00-12 JST に
// 当たっていた）。分は minute 0 を避けプラットフォームの herd を回避。
// vercel.json: { "path": "/api/cron/sync-events", "schedule": "7 10 * * *" }

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

    // トップページのライブ取得分で日付が空の件数（JOYフォーマット変更のカナリア）。
    // マージ前の topEvents だけを見る（過去保持分の空dateに引きずられないため）。
    const topEmptyDates = topEvents.filter((e) => !e.date).length;

    // どこオリ（dokori.net）のホワイトリスト大会を取得。JOY本体を絶対に巻き込まないよう
    // 完全隔離（例外は握りつぶし空配列）。合成ID（DOKORI_ID_BASE 以上）なので JOY と衝突しない。
    let dokoriEvents: JOEEvent[] = [];
    try {
      dokoriEvents = await scrapeDokoriEvents();
    } catch (dkErr) {
      console.error("dokori event sync failed (ignored):", dkErr);
    }

    // 全イベントをマージ（ID重複排除、トップページ優先）
    const eventMap = new Map<number, JOEEvent>();
    for (const events of archiveResults) {
      for (const e of events) eventMap.set(e.joe_event_id, e);
    }
    for (const e of topEvents) eventMap.set(e.joe_event_id, e);
    for (const e of dokoriEvents) eventMap.set(e.joe_event_id, e);

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
        // JOYアーカイブはtagsを返さないため、トップページから落ちた後も直近取得値を保持する。
        if (event.tags.length === 0 && existing.tags.length > 0) {
          event.tags = [...existing.tags];
        }
        if (event.source === "dokori") {
          // どこオリはスクレイプ時に会場座標を持つため store で上書きしない（会場変更にも追従）。
          // 万一スクレイプで座標が取れなかった場合のみ store からフォールバック。
          if (event.lat == null && existing.lat != null) {
            event.lat = existing.lat;
            event.lng = existing.lng;
          }
        } else {
          // JOY は座標を遅延バッチで補完するため、毎回のライブ取得では座標が無い → store から復元。
          event.lat = existing.lat;
          event.lng = existing.lng;
        }
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
    if (jstDay === 3 && process.env.VERCEL_DEPLOY_HOOK) {
      try {
        const deployRes = await fetch(process.env.VERCEL_DEPLOY_HOOK, {
          method: "POST",
        });
        const deployData = await deployRes.json();
        deployResult = { triggered: true, job: deployData.job?.id };
      } catch (deployErr) {
        console.error("Deploy trigger failed:", deployErr);
        deployResult = { triggered: false, error: String(deployErr) };
      }
    }

    const payload = {
      success: true,
      events: {
        count: freshEvents.length,
        coordinates: coordResult,
        top_scraped: topEvents.length,
        top_empty_dates: topEmptyDates,
      },
      lapcenter: lapcenterResult,
      deploy: deployResult,
      synced_at: new Date().toISOString(),
    };
    await logCron("sync-events", "success", payload, Date.now() - start);

    // 日付パースの異常（JOYフォーマット変更等）を無音にしない。閾値超で警告メール（24hデダブ）。
    if (topEvents.length > 0 && topEmptyDates >= EMPTY_DATE_WARN_THRESHOLD) {
      await notifyCronWarning(
        "sync-events",
        "high_empty_dates",
        {
          warning: "high_empty_dates",
          top_empty_dates: topEmptyDates,
          top_scraped: topEvents.length,
          hint: "JOYトップページの日付フォーマット変更の可能性。parseDateWithAttr を確認。",
        },
        Date.now() - start,
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Event sync failed:", error);
    await logCron("sync-events", "error", { error: String(error) }, Date.now() - start);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}
