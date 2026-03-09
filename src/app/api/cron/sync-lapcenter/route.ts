import { NextResponse } from "next/server";
import { matchLapCenterEvents, fetchEventClasses, fetchSplitList } from "@/lib/scraper/lapcenter";
import { readEvents, writeEvents } from "@/lib/events-store";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readFileSync } from "fs";
import { join } from "path";

// Vercel Cron: 日次 12:00 JST (03:00 UTC)
// 水曜日は巡航速度・ミス率スクレイプも実行
// vercel.json: { "path": "/api/cron/sync-lapcenter", "schedule": "0 3 * * *" }

const SPRINT_KEYWORDS = ["スプリント", "Sprint", "sprint", "パークO", "パーク・オリエンテーリング"];

const CLUB_ALIASES: Record<string, string> = {
  "北大": "北海道大学", "東北大": "東北大学", "東大": "東京大学",
  "名大": "名古屋大学", "京大": "京都大学", "阪大": "大阪大学",
  "九大": "九州大学", "筑波大": "筑波大学", "千葉大": "千葉大学",
  "横国大": "横浜国立大学", "金大": "金沢大学", "新大": "新潟大学",
  "岡大": "岡山大学", "広大": "広島大学", "熊大": "熊本大学",
  "信大": "信州大学", "静大": "静岡大学",
  "大阪": "大阪OLC", "練馬": "練馬OLC", "レオ": "OLCレオ",
};

function normalizeClub(club: string): string {
  let s = club;
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
  s = s.replace(/olc/gi, "OLC").replace(/olk/gi, "OLK");
  s = s.replace(/OLクラブ/g, "OLC");
  s = s.replace(/OLC$/, "").replace(/OLK$/, "");
  s = s.trim();
  if (CLUB_ALIASES[s]) s = CLUB_ALIASES[s];
  return s;
}

function isSprint(eventName: string): boolean {
  return SPRINT_KEYWORDS.some((kw) => eventName.includes(kw));
}

const MAX_RUNNER_EVENTS = 3; // 1回のCronで処理する最大イベント数
const DELAY_MS = 800;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // ---- LapCenter イベントマッチング (日次) ----
    const events = (await readEvents()).map((e) => ({ ...e }));
    const beforeUnmatched = events.filter((e) => !e.lapcenter_event_id).length;
    const result = await matchLapCenterEvents(events);
    const afterUnmatched = events.filter((e) => !e.lapcenter_event_id).length;
    const newMatches = beforeUnmatched - afterUnmatched;

    if (newMatches > 0) {
      await writeEvents(events);
    }

    // ---- 巡航速度・ミス率スクレイプ (水曜のみ) ----
    let runnersResult = null;
    const jstDay = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCDay();

    if (jstDay === 3) {
      try {
        runnersResult = await scrapeRunners(events);
      } catch (err) {
        console.error("LC runner scrape failed:", err);
        runnersResult = { error: String(err) };
      }
    }

    return NextResponse.json({
      success: true,
      matching: {
        new_matches: newMatches,
        total_matched: result.matched,
        total_events: result.total,
        lc_events_fetched: result.lcEventsCount,
      },
      runners: runnersResult,
      synced_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Lap Center sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}

async function scrapeRunners(
  events: Array<{ joe_event_id: number; name: string; date: string; lapcenter_event_id?: number }>
) {
  // 追跡選手のロード
  const athleteIndex = JSON.parse(
    readFileSync(join(process.cwd(), "public/data/athlete-index.json"), "utf-8")
  );
  const athleteLookup = new Map<string, { joyName: string; clubs: string[] }>();
  for (const [name, summary] of Object.entries(athleteIndex.athletes) as [string, any][]) {
    athleteLookup.set(name.replace(/\s+/g, ""), { joyName: name, clubs: summary.clubs || [] });
  }

  // 処理済みイベントキーをDBから取得
  const { data: existingKeys } = await supabaseAdmin
    .from("lc_performances")
    .select("event_date, event_name")
    .limit(10000);

  const processedKeys = new Set<string>();
  if (existingKeys) {
    for (const row of existingKeys) {
      processedKeys.add(`${row.event_date}:${row.event_name}`);
    }
  }

  // 未処理のLC付きイベント（新しい順）
  const lcEvents = events
    .filter((e) => e.lapcenter_event_id && !processedKeys.has(`${e.date}:${e.name}`))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_RUNNER_EVENTS);

  let totalRunners = 0;
  let totalClasses = 0;
  const newRecords: Array<{
    athlete_name: string;
    event_date: string;
    event_name: string;
    class_name: string;
    cruising_speed: number;
    miss_rate: number;
    race_type: string;
  }> = [];

  for (const event of lcEvents) {
    const eventId = event.lapcenter_event_id!;
    const eventType = isSprint(event.name) ? "sprint" : "forest";

    const classes = await fetchEventClasses(eventId);
    if (classes.length === 0) continue;

    for (const cls of classes) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      const runners = await fetchSplitList(eventId, cls.classId);

      for (const r of runners) {
        const normalized = r.name.replace(/\s+/g, "");
        const entry = athleteLookup.get(normalized);
        if (!entry) continue;

        const lcClubs = r.club ? r.club.split("/").map((c) => normalizeClub(c)) : [];
        const joyClubs = entry.clubs.map((c) => normalizeClub(c));
        const clubMatch =
          lcClubs.length === 0 ||
          joyClubs.length === 0 ||
          lcClubs.some((lc) =>
            joyClubs.some((joy) => lc === joy || lc.includes(joy) || joy.includes(lc))
          );
        if (!clubMatch) continue;

        // speed=100 & miss=0 は基準ランナー（1人クラス等）で無意味なデータ
        if (r.speed === 100 && r.missRate === 0) continue;

        newRecords.push({
          athlete_name: entry.joyName,
          event_date: event.date,
          event_name: event.name,
          class_name: cls.className,
          cruising_speed: r.speed,
          miss_rate: r.missRate,
          race_type: eventType,
        });
        totalRunners++;
      }
      totalClasses++;
    }
  }

  // DBに保存（バッチ upsert）
  let dbInserted = 0;
  for (let i = 0; i < newRecords.length; i += 500) {
    const batch = newRecords.slice(i, i + 500);
    const { error } = await supabaseAdmin
      .from("lc_performances")
      .upsert(batch, { onConflict: "athlete_name,event_date,event_name,class_name" });
    if (error) {
      console.error("LC DB upsert failed:", error.message);
    } else {
      dbInserted += batch.length;
    }
  }

  return {
    events_processed: lcEvents.length,
    classes_processed: totalClasses,
    tracked_runners: totalRunners,
    db_inserted: dbInserted,
  };
}
