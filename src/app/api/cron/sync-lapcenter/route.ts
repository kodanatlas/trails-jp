import { NextResponse } from "next/server";
import { matchLapCenterEvents, fetchEventClasses, fetchSplitList } from "@/lib/scraper/lapcenter";
import { readEvents, writeEvents } from "@/lib/events-store";
import { readLCRunners, writeLCRunners, type LCPerformance } from "@/lib/lapcenter-runners-store";
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
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
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
      { error: "Sync failed", details: String(error) },
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

  // 既存データの読み込み
  const existing = await readLCRunners();
  const athletes = existing.athletes;

  // 処理済みイベントキー
  const processedKeys = new Set<string>();
  for (const perfs of Object.values(athletes)) {
    for (const p of perfs) {
      processedKeys.add(`${p.d}:${p.e}`);
    }
  }

  // 未処理のLC付きイベント（新しい順）
  const lcEvents = events
    .filter((e) => e.lapcenter_event_id && !processedKeys.has(`${e.date}:${e.name}`))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_RUNNER_EVENTS);

  let totalRunners = 0;
  let totalClasses = 0;

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

        if (!athletes[entry.joyName]) athletes[entry.joyName] = [];
        athletes[entry.joyName].push({
          d: event.date,
          e: event.name,
          c: cls.className,
          s: r.speed,
          m: r.missRate,
          t: eventType,
        });
        totalRunners++;
      }
      totalClasses++;
    }
  }

  // Sort & save
  for (const perfs of Object.values(athletes)) {
    perfs.sort((a, b) => a.d.localeCompare(b.d));
  }
  existing.generatedAt = new Date().toISOString();
  await writeLCRunners(existing);

  return {
    events_processed: lcEvents.length,
    classes_processed: totalClasses,
    tracked_runners: totalRunners,
    total_athletes: Object.keys(athletes).length,
  };
}
