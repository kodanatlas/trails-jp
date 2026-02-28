import * as cheerio from "cheerio";

export interface LapCenterEvent {
  eventId: number;
  name: string;
  date: string;
}

const BASE_URL = "https://mulka2.com/lapcenter";

// ---------------------------------------------------------------------------
// Lap Center からイベント一覧を取得
// ---------------------------------------------------------------------------

export async function fetchLapCenterEvents(year: number): Promise<LapCenterEvent[]> {
  const url = `${BASE_URL}/index.jsp?year=${year}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "trails.jp/1.0 (lapcenter sync)" },
  });
  if (!res.ok) return [];

  const html = await res.text();
  const $ = cheerio.load(html);
  const events: LapCenterEvent[] = [];
  let currentMonth = 0;

  $("table.table-condensed tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 3) return;

    const monthText = tds.eq(0).text().trim();
    const monthMatch = monthText.match(/(\d{1,2})月/);
    if (monthMatch) currentMonth = parseInt(monthMatch[1], 10);
    if (!currentMonth) return;

    const dayText = tds.eq(1).text().trim();
    const dayMatch = dayText.match(/(\d{1,2})日/);
    if (!dayMatch) return;
    const day = parseInt(dayMatch[1], 10);

    const date = `${year}-${String(currentMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    tds.eq(2).find("a[href*='event=']").each((_, a) => {
      const href = $(a).attr("href") || "";
      const idMatch = href.match(/event=(\d+)/);
      if (!idMatch) return;
      const eventId = parseInt(idMatch[1], 10);
      const name = $(a).text().trim();
      if (!name) return;
      events.push({ eventId, name, date });
    });
  });

  return events;
}

// ---------------------------------------------------------------------------
// Fuzzy matching
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "大会", "練習会", "練習", "オリエンテーリング", "オリエンテーリン", "スプリント", "ミドル",
  "ロング", "リレー", "公開", "午前", "午後", "の部", "1日目", "2日目",
  "3日目", "day1", "day2", "day3", "Day1", "Day2", "Day3",
  "兼", "in", "IN", "OL", "ロゲイニング",
  "年度", "記念", "中止", "競技", "選手権", "体験会", "講習会",
  "日本", "全国", "地区", "JOA", "OLC", "杯", "壮行会", "日本代表",
  "パーク", "県民", "市民",
]);

function normalize(name: string): string {
  let s = name;
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
  s = s.replace(/【[^】]*】/g, "");
  s = s.replace(/第\s*[0-9一二三四五六七八九十百千]+\s*回/g, "");
  s = s.replace(/(令和|平成|昭和)\s*[0-9一二三四五六七八九十]+\s*年度?/g, "");
  s = s.replace(/20\d{2}年度?/g, "");
  s = s.replace(/20\d{6}/g, "");
  s = s.replace(/[（(][^)）]*[)）]/g, "");
  s = s.replace(/[・\-\s　&＆「」『』【】〜～/／\\.,、。!！?？:：;；#＃@＠+＋=＝_＿<>＜＞'"'"'"^`~|｜{}\[\]［］]/g, " ");
  return s.trim();
}

function isStopRelated(token: string): boolean {
  if (STOP_WORDS.has(token)) return true;
  for (const sw of STOP_WORDS) {
    if (sw.includes(token) && token.length < sw.length) return true;
  }
  return false;
}

function extractSignificantTokens(normalizedName: string): string[] {
  return normalizedName.split(/\s+/).filter((t) => t.length >= 3 && !isStopRelated(t));
}

function coreString(normalizedName: string): string {
  let s = normalizedName.replace(/\s+/g, "");
  for (const sw of STOP_WORDS) {
    s = s.replaceAll(sw, "");
  }
  return s;
}

export function fuzzyMatch(name1: string, name2: string): boolean {
  const norm1 = normalize(name1);
  const norm2 = normalize(name2);
  const full1 = norm1.replace(/\s+/g, "");
  const full2 = norm2.replace(/\s+/g, "");

  if (!full1 || !full2) return false;
  if (full1 === full2) return true;

  const shorter = full1.length <= full2.length ? full1 : full2;
  const longer = full1.length <= full2.length ? full2 : full1;
  if (shorter.length >= 4 && longer.includes(shorter)) return true;

  const core1 = coreString(norm1);
  const core2 = coreString(norm2);

  if (core1.length >= 3 && core2.length >= 3) {
    if (core1 === core2) return true;
    const cShorter = core1.length <= core2.length ? core1 : core2;
    const cLonger = core1.length <= core2.length ? core2 : core1;
    if (cShorter.length >= 4 && cLonger.includes(cShorter)) return true;
  }

  const tokens1 = extractSignificantTokens(norm1);
  const tokens2 = extractSignificantTokens(norm2);

  if (tokens1.length > 0 && tokens2.length > 0) {
    const t1InF2 = tokens1.some((t) => full2.includes(t));
    const t2InF1 = tokens2.some((t) => full1.includes(t));
    if (t1InF2 && t2InF1) return true;

    for (const t of tokens1) {
      if (t.length >= 5 && !isStopRelated(t) && full2.includes(t)) return true;
    }
    for (const t of tokens2) {
      if (t.length >= 5 && !isStopRelated(t) && full1.includes(t)) return true;
    }
  }

  if (core1.length >= 5 && core2.length >= 5) {
    const trigrams1 = new Set<string>();
    for (let i = 0; i <= core1.length - 3; i++) {
      trigrams1.add(core1.substring(i, i + 3));
    }
    let common = 0;
    const total2 = Math.max(1, core2.length - 2);
    for (let i = 0; i <= core2.length - 3; i++) {
      if (trigrams1.has(core2.substring(i, i + 3))) common++;
    }
    const ratio1 = common / trigrams1.size;
    const ratio2 = common / total2;
    if (Math.min(ratio1, ratio2) >= 0.65 && common >= 5) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Match JOE events with Lap Center events
// ---------------------------------------------------------------------------

export interface MatchResult {
  matched: number;
  total: number;
  lcEventsCount: number;
}

/**
 * JOE イベントに Lap Center リンクを付与する
 * events 配列を直接変更する (in-place)
 */
export async function matchLapCenterEvents<
  T extends { joe_event_id: number; name: string; date: string; lapcenter_event_id?: number; lapcenter_url?: string }
>(joeEvents: T[]): Promise<MatchResult> {
  // Determine which years to fetch — min event year から current year まで全取得
  const now = new Date();
  const currentYear = now.getFullYear();
  const eventYears = joeEvents
    .map((e) => parseInt(e.date.slice(0, 4), 10))
    .filter((y) => y >= 2019 && y <= currentYear);
  const minYear = eventYears.length > 0 ? Math.min(...eventYears) : currentYear - 1;
  const years: number[] = [];
  for (let y = minYear; y <= currentYear; y++) years.push(y);

  // Fetch Lap Center events
  const lcEvents: LapCenterEvent[] = [];
  for (const year of years) {
    const events = await fetchLapCenterEvents(year);
    lcEvents.push(...events);
  }

  // Group LC events by date
  const lcByDate = new Map<string, LapCenterEvent[]>();
  for (const lc of lcEvents) {
    if (!lcByDate.has(lc.date)) lcByDate.set(lc.date, []);
    lcByDate.get(lc.date)!.push(lc);
  }

  // Track already matched LC event IDs (prevent duplicate matching)
  const usedLcIds = new Set<number>();
  // Preserve existing matches
  for (const joe of joeEvents) {
    if (joe.lapcenter_event_id) usedLcIds.add(joe.lapcenter_event_id);
  }

  let matched = 0;
  for (const joe of joeEvents) {
    // Only match events without existing Lap Center link
    if (joe.lapcenter_event_id) {
      matched++;
      continue;
    }

    const candidates = lcByDate.get(joe.date) || [];
    if (candidates.length === 0) continue;

    let bestMatch: LapCenterEvent | null = null;
    for (const lc of candidates) {
      if (usedLcIds.has(lc.eventId)) continue;
      if (fuzzyMatch(joe.name, lc.name)) {
        bestMatch = lc;
        break;
      }
    }

    if (bestMatch) {
      joe.lapcenter_event_id = bestMatch.eventId;
      joe.lapcenter_url = `https://mulka2.com/lapcenter/lapcombat2/index.jsp?event=${bestMatch.eventId}&file=1`;
      usedLcIds.add(bestMatch.eventId);
      matched++;
    }
  }

  return { matched, total: joeEvents.length, lcEventsCount: lcEvents.length };
}
