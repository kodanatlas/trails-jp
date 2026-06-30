import { NextResponse } from "next/server";
import { matchLapCenterEvents, fetchEventClasses, fetchSplitList, MANUAL_LC_OVERRIDE_EVENT_IDS } from "@/lib/scraper/lapcenter";
import { readEvents, writeEvents } from "@/lib/events-store";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readFileSync } from "fs";
import { logCron } from "@/lib/cron-logger";
import { join } from "path";
import { readEntryIndex } from "@/lib/entry-index-store";
import { notifyCronWarning } from "@/lib/cron-notifier";
import { entryIndexAgeHours, isEntryIndexStale } from "@/lib/entries/freshness";

// 索引鮮度ウォッチドッグの閾値（時間）。これより古ければ sync-entries の無音停止を疑い警告。
// このジョブは sync-entries の8h後(03:00 UTC)に走るため、26h で「前夜の定期実行スキップ」を検知できる。
const STALE_INDEX_WARN_HOURS = 26;

// 多クラスの大規模イベントでも壁時計予算内で処理できるよう実行時間上限を延長。
export const maxDuration = 60;

// Vercel Cron: 日次 12:00 JST (03:00 UTC)
// 巡航速度・ミス率スクレイプも毎日実行（壁時計予算内で新しい順に処理）
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
  "東京科学大OLT": "東京科学大学",
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

// 1回のCronで処理候補とするイベント数の上限（実処理数は下記の壁時計予算で決まる）
const MAX_RUNNER_EVENTS = 40;
// クラス間スリープ。多クラス大会(インカレ=18クラス等)では 800ms だと睡眠だけで ~14s 消費し
// 1イベントで予算を食い潰して取りこぼす。mulka2 への礼儀を保ちつつ取込スループットを上げるため短縮。
const DELAY_MS = 300;
// 新しいイベントへの着手を打ち切る経過時間（リクエスト開始からの ms）。
// maxDuration=60s に対し、着手後に多クラスイベントが完走できる余裕(~30s)を残す。
const START_EVENT_BEFORE_MS = 30_000;

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
    const events = (await readEvents()).map((e) => ({ ...e }));

    // ---- LapCenter イベントマッチング (日次・非致命) ----
    // マッチングは sync-events でも毎日行われ events ストアに永続化される。ここでの
    // mulka2 取得が一時的に失敗(TypeError: fetch failed 等)しても致命とはせず、
    // ストア済みマッチを使って下のスクレイプを必ず続行する（毎日のスクレイプを守る）。
    let matchingResult: Record<string, unknown>;
    try {
      const beforeUnmatched = events.filter((e) => !e.lapcenter_event_id).length;
      const result = await matchLapCenterEvents(events);
      const afterUnmatched = events.filter((e) => !e.lapcenter_event_id).length;
      const newMatches = beforeUnmatched - afterUnmatched;
      if (newMatches > 0) {
        await writeEvents(events);
      }
      matchingResult = {
        new_matches: newMatches,
        total_matched: result.matched,
        total_events: result.total,
        lc_events_fetched: result.lcEventsCount,
      };
    } catch (err) {
      console.error("LC matching failed (non-fatal):", err);
      matchingResult = { error: String(err) };
    }

    // ---- 巡航速度・ミス率スクレイプ (毎日・壁時計予算内で新しい順に処理) ----
    let runnersResult = null;
    try {
      runnersResult = await scrapeRunners(events, start);
    } catch (err) {
      console.error("LC runner scrape failed:", err);
      runnersResult = { error: String(err) };
    }

    const payload = {
      success: true,
      matching: matchingResult,
      runners: runnersResult,
      synced_at: new Date().toISOString(),
    };

    // ---- 索引鮮度ウォッチドッグ (非致命・隔離) ----
    // sync-entries が無音で停止すると entry-index.json が古くなり、最近の申込者が選手ページに出ない。
    // 既存通知は「実行された上での異常」しか拾わないため、実行自体のスキップはここで初めて可視化する。
    // この処理は lapcenter 本処理の結果に一切影響させない（例外は握りつぶしログのみ）。
    try {
      const now = Date.now();
      const index = await readEntryIndex();
      const generatedAt = index?.generatedAt ?? null;
      if (isEntryIndexStale(generatedAt, now, STALE_INDEX_WARN_HOURS)) {
        const ageHours = entryIndexAgeHours(generatedAt, now);
        await notifyCronWarning(
          "sync-entries",
          "stale_entry_index",
          {
            warning: "stale_entry_index",
            generatedAt,
            ageHours,
            threshold_hours: STALE_INDEX_WARN_HOURS,
            hint: "sync-entries が定期実行をスキップした可能性。索引が古いと最近の申込者が選手ページに出ない。",
          },
          0,
        );
      }
    } catch (e) {
      console.error("entry-index freshness check failed (ignored):", e);
    }

    await logCron("sync-lapcenter", "success", payload, Date.now() - start);
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Lap Center sync failed:", error);
    await logCron("sync-lapcenter", "error", { error: String(error) }, Date.now() - start);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}

async function scrapeRunners(
  events: Array<{ joe_event_id: number; name: string; date: string; lapcenter_event_id?: number }>,
  requestStart: number
) {
  // 追跡選手のロード
  const athleteIndex = JSON.parse(
    readFileSync(join(process.cwd(), "public/data/athlete-index.json"), "utf-8")
  );
  const athleteLookup = new Map<string, { joyName: string; clubs: string[] }>();
  for (const [name, summary] of Object.entries(athleteIndex.athletes) as [string, any][]) {
    athleteLookup.set(name.replace(/\s+/g, ""), { joyName: name, clubs: summary.clubs || [] });
  }

  // 処理済みイベントキーをDBから取得（distinct (event_date, event_name) を JS 側で一意化）。
  // 注: 旧実装は limit(10000) で、2万行超のテーブルではキーを取りこぼし→取得済みイベントを
  //     再スクレイプして枠を浪費していた。十分大きな limit で全行取得して一意化する。
  const { data: existingKeys } = await supabaseAdmin
    .from("lc_performances")
    .select("event_date, event_name")
    .limit(100000);

  const processedKeys = new Set<string>();
  if (existingKeys) {
    for (const row of existingKeys) {
      processedKeys.add(`${row.event_date}:${row.event_name}`);
    }
  }

  // 未処理のLC付きイベント。手動マッチ表のイベントを最優先（古くてもキュー先頭へ）→ それ以外は新しい順。
  // スクレイパは壁時計予算で1回数件しか進まず、古い手動マッチ大会(ジュニア/インカレ等)が
  // 新しい順だと永遠にキュー後方で届かないため、明示的に優先して必ず取得させる。
  const isPriority = (e: { lapcenter_event_id?: number }) =>
    e.lapcenter_event_id != null && MANUAL_LC_OVERRIDE_EVENT_IDS.has(e.lapcenter_event_id);
  const lcEvents = events
    .filter((e) => e.lapcenter_event_id && !processedKeys.has(`${e.date}:${e.name}`))
    .sort((a, b) => {
      const pa = isPriority(a) ? 1 : 0;
      const pb = isPriority(b) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      // 優先(手動マッチ)同士は古い順=長く取りこぼし続けた古い大会を先に回収する。
      // (新しい順だと最古のインカレミドル等が毎回キュー後方で予算切れに遭い永遠に未取込になる)
      // 非優先は従来どおり新しい順で、直近大会の鮮度を保つ。
      if (pa === 1) return a.date.localeCompare(b.date);
      return b.date.localeCompare(a.date);
    })
    .slice(0, MAX_RUNNER_EVENTS);

  let totalRunners = 0;
  let totalClasses = 0;
  let eventsProcessed = 0;
  let dbInserted = 0;
  let stoppedForBudget = false;

  for (const event of lcEvents) {
    // 予算超過後は新しいイベントに着手しない（着手済みイベントは完走させ、イベント単位で保存）
    if (Date.now() - requestStart > START_EVENT_BEFORE_MS) {
      stoppedForBudget = true;
      break;
    }

    const eventId = event.lapcenter_event_id!;
    const eventType = isSprint(event.name) ? "sprint" : "forest";

    const classes = await fetchEventClasses(eventId);
    if (classes.length === 0) {
      eventsProcessed++;
      continue;
    }

    // このイベント分のレコードを集め、イベント単位で即upsert。
    // 途中で関数がタイムアウトしても、完了済みイベントの行は保全される（全損防止）。
    const eventRecords: Array<{
      athlete_name: string;
      event_date: string;
      event_name: string;
      class_name: string;
      cruising_speed: number;
      miss_rate: number;
      race_type: string;
    }> = [];

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

        eventRecords.push({
          athlete_name: entry.joyName,
          event_date: event.date,
          event_name: event.name,
          class_name: cls.className,
          cruising_speed: r.speed,
          miss_rate: r.missRate,
          race_type: eventType,
        });
      }
      totalClasses++;
    }

    // イベント単位でバッチ upsert（冪等: athlete_name,event_date,event_name,class_name）
    for (let i = 0; i < eventRecords.length; i += 500) {
      const batch = eventRecords.slice(i, i + 500);
      const { error } = await supabaseAdmin
        .from("lc_performances")
        .upsert(batch, { onConflict: "athlete_name,event_date,event_name,class_name" });
      if (error) {
        console.error("LC DB upsert failed:", error.message);
      } else {
        dbInserted += batch.length;
      }
    }

    totalRunners += eventRecords.length;
    eventsProcessed++;
  }

  return {
    events_processed: eventsProcessed,
    candidate_events: lcEvents.length,
    classes_processed: totalClasses,
    tracked_runners: totalRunners,
    db_inserted: dbInserted,
    stopped_for_budget: stoppedForBudget,
  };
}
