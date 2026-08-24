import * as cheerio from "cheerio";
import { fetch as lcFetch, Agent } from "undici";
import { parseSplitListDetailed } from "./lapcenter-detail";

export type { LapCenterRunnerDetail } from "./lapcenter-detail";

// mulka2.com は 2026-06 の証明書更新でチェーンが不完全になり、Node(undici)の厳格TLS検証では
// "unable to get local issuer certificate"（中間CA: Let's Encrypt YR2）で失敗する。
// curl/ブラウザは AIA でチェーンを補完するため成功するが、undici は AIA 非対応。
// mulka2 への接続に限り証明書検証を緩めて取得する。公開成績データの取得のみで認証情報は
// 送らないため影響は限定的（mulka2 がチェーンを直せば元の検証に戻してよい）。
const mulka2Dispatcher = new Agent({ connect: { rejectUnauthorized: false } });

export interface LapCenterEvent {
  eventId: number;
  name: string;
  date: string;
}

export interface LapCenterClass {
  classId: number;
  className: string;
  distance: string;
}

export interface LapCenterRunnerStat {
  name: string;
  club: string;
  rank: number;
  result: string;
  speed: number;    // 巡航速度 (%)
  missRate: number;  // ミス率 (%)
}

const BASE_URL = "https://mulka2.com/lapcenter";

// ---------------------------------------------------------------------------
// Lap Center からイベント一覧を取得
// ---------------------------------------------------------------------------

export async function fetchLapCenterEvents(year: number): Promise<LapCenterEvent[]> {
  const url = `${BASE_URL}/index.jsp?year=${year}`;
  const res = await lcFetch(url, {
    headers: { "User-Agent": "trails.jp/1.0 (lapcenter sync)" },
    dispatcher: mulka2Dispatcher,
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

// 大学略称 → 正式名称（「〇〇大」が大学名の一部として使われるケース）
const UNIVERSITY_ALIASES: Record<string, string> = {
  "北大": "北海道大学", "東北大": "東北大学", "東大": "東京大学",
  "名大": "名古屋大学", "京大": "京都大学", "阪大": "大阪大学",
  "九大": "九州大学", "筑波大": "筑波大学", "千葉大": "千葉大学",
  "横国大": "横浜国立大学", "金大": "金沢大学", "新大": "新潟大学",
  "岡大": "岡山大学", "広大": "広島大学", "熊大": "熊本大学",
  "信大": "信州大学", "静大": "静岡大学", "神大": "神戸大学",
  "茨大": "茨城大学", "埼大": "埼玉大学", "群大": "群馬大学",
};

// イベント名の略称・頭字語 → 展開形
const EVENT_ALIASES: [RegExp, string][] = [
  [/\bBMO\b/gi, "忘年マウンテンオリエンテーリング"],
  [/\bOMO\b/gi, "奥武蔵マウンテンオリエンテーリング"],
  [/\bMAMM\b/gi, "南アルプスマウンテンマラソン"],
  [/スプセレ/g, "スプリントセレクション"],
  [/インカレ/g, "日本学生選手権"],
];

function normalize(name: string): string {
  let s = name;
  // 全角→半角
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

  // 表記揺れ正規化
  s = s.replace(/ウエ/g, "ウェ");

  // 大学略称展開（「筑波大」→「筑波大学」等、ただし既に「大学」が続く場合はスキップ）
  for (const [abbr, full] of Object.entries(UNIVERSITY_ALIASES)) {
    const re = new RegExp(abbr + "(?!学)", "g");
    s = s.replace(re, full);
  }

  // イベント名略称・頭字語の展開
  for (const [pattern, replacement] of EVENT_ALIASES) {
    s = s.replace(pattern, replacement);
  }

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
    if (cShorter.length >= 3 && cLonger.includes(cShorter)) return true;
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
  /** lapcenter_event_id を新規セット/変更した件数（新規マッチ＋override再マッチ）。>0 なら呼び出し側は writeEvents すべき。 */
  changed: number;
}

/**
 * JOE イベントに Lap Center リンクを付与する
 * events 配列を直接変更する (in-place)
 */
/**
 * 手動マッチ表: joe_event_id → LapCenter event ID。
 * 自動マッチ（同一日付グルーピング＋fuzzyMatch 名前照合）が漏らす既知イベントを明示マッピング。
 * 漏れの主因＝LapCenter 側の開催日が JOY と異なる / 名前の差が大きい / mulka2 のイベント一覧に未掲載。
 * 新たに漏れが判明したらここに (joe_event_id: lapcenter_event_id) を追記する。
 */
export const MANUAL_LC_OVERRIDES: Record<number, number> = {
  2448: 9845, // 第48回東大OLK大会前日大会 (2026-06-13)
  2356: 9775, // 富山オリエンテーリング大会Day1スプリント (2026-05-16) — JOY「富山大会Day1」は正規化後 core が「富山」2字で fuzzyMatch 不成立(自動マッチ漏れ)
  2370: 9656, // 小豆島大会Day1 (2026-03-20) — fuzzy 不成立で未マッチ。Day2(ロング)のみ取込済だった
  2197: 9714, // ジュニアチャンピオン大会（43JC） (2026-04-19)
  2286: 9644, // インカレミドル2025 (2026-03-14)
  2282: 9647, // インカレリレー2025 (2026-03-15)
  2575: 9908, // とちトレ#8 (2026-07-12) — mulka2 が同一大会を二重登録(9907/9908・同一12クラス)。自動マッチは若い id 9907 を採用したが 9908 が正(修正版)。旧 9907 のDB行(lc_leg_splits/lc_leg_events/該当lc_performances)は手動削除済。
  // 中高選手権: JOY が略称「中高選手権」、LapCenter が正式名「全国中学校高等学校オリエンテーリング選手権大会」。
  // STOP_WORDS が「選手権」「大会」「オリエンテーリング」を削るため core が「中高団体オープン」vs「中学校高等学校」
  // となり、包含・トライグラムのいずれも成立しない（実測でトライグラム共通数 0）。2022年・2023年の本大会も
  // 同じ理由で未突合のまま落ちていた既知の恒常パターン。
  2396: 9974, // 中高選手権 個人オープン競技 (2026-08-22) — LC は「第40回全国中学校高等学校オリエンテーリング選手権大会個人競技」。オープン競技(AL1/AL2/AM)は本大会と同一 mulka2 イベントに同居。
  2397: 9976, // 中高選手権 団体オープン競技 (2026-08-23) — LC は「第40回全国中学校高等学校オリエンテーリング選手権大会」(リレー)。オープン競技(ORL/ORM/ORS)は本大会と同一 mulka2 イベントに同居。
  // 彩の森入間公園の体験会: JOY が会場名「彩の森入間公園」、LapCenter が市名「入間市」を使うため名前だけでは
  // 原理的に結び付かない（core は「彩の森入間公園併設ロゲ」vs「入間市」）。2024-04 以降の全30回が未突合。
  // 恒久対策には会場名↔市名の橋渡し or prefecture 併用が要るため、当面は開催の都度ここに追記する。
  2518: 9973, // 彩の森入間公園OL体験会＆併設ロゲ (2026-08-22) — LC は「第56回(26年度8月度)入間市オリエンテーリング体験会」。主催はいずれも入間市オリエンテーリングクラブ。
};

/** 手動マッチ表でマッチした LapCenter event id の集合（スクレイプ優先用）。 */
export const MANUAL_LC_OVERRIDE_EVENT_IDS = new Set<number>(Object.values(MANUAL_LC_OVERRIDES));

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
  // lapcenter_event_id を新規セット/変更した件数。override で既マッチを別 id へ再マッチしても
  // 未マッチ件数は減らないため、呼び出し側が「未マッチ→マッチの減少」だけで writeEvents を
  // 判定すると再マッチが Storage に永続化されない。それを検知するための変更カウンタ。
  let changed = 0;
  for (const joe of joeEvents) {
    // 手動オーバーライドを最優先で適用（未マッチも誤マッチも正しい id へ強制設定）
    const override = MANUAL_LC_OVERRIDES[joe.joe_event_id];
    if (override) {
      if (joe.lapcenter_event_id !== override) {
        if (joe.lapcenter_event_id) usedLcIds.delete(joe.lapcenter_event_id);
        joe.lapcenter_event_id = override;
        joe.lapcenter_url = `https://mulka2.com/lapcenter/lapcombat2/index.jsp?event=${override}&file=1`;
        usedLcIds.add(override);
        changed++;
      }
      matched++;
      continue;
    }

    // 既にマッチ済みはスキップ
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
      changed++;
    }
  }

  return { matched, total: joeEvents.length, lcEventsCount: lcEvents.length, changed };
}

// ---------------------------------------------------------------------------
// イベント内クラス一覧を取得
// ---------------------------------------------------------------------------

// mulka2 の file 番号は大会ごとに異なる。file=1 がスタートリストで、結果＋ラップ解析が
// file=2 以降のことがある（例: 2日間大会/リハーサルは file=1 スタートリスト・file=2 記録一覧/ラップ解析）。
// event ページ(index.jsp?event=X, file 未指定)の file 一覧から「記録/ラップ/リザルト/成績」系ラベルで
// 「スタート」を含まない最小 file を選ぶ。判別不能なら 1 にフォールバック。プロセス内キャッシュで
// event ごとの重複取得を避ける（2026-07-13: file 固定で結果分析が空になる不具合の修正）。
const resultsFileCache = new Map<number, number>();
export async function resolveResultsFile(eventId: number): Promise<number> {
  const cached = resultsFileCache.get(eventId);
  if (cached != null) return cached;
  let file = 1;
  try {
    const res = await lcFetch(`${BASE_URL}/lapcombat2/index.jsp?event=${eventId}`, {
      headers: { "User-Agent": "trails.jp/1.0 (lapcenter sync)" },
      dispatcher: mulka2Dispatcher,
    });
    if (res.ok) {
      const html = await res.text();
      const re = /<a[^>]*file=(\d+)[^>]*>([\s\S]*?)<\/a>/g;
      const candidates: number[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        const label = m[2].replace(/<[^>]+>/g, "");
        if (/記録|ラップ|リザルト|成績/.test(label) && !/スタート/.test(label)) {
          candidates.push(parseInt(m[1], 10));
        }
      }
      if (candidates.length > 0) file = Math.min(...candidates);
    }
  } catch {
    // 取得失敗 → file=1 フォールバック
  }
  resultsFileCache.set(eventId, file);
  return file;
}

export async function fetchEventClasses(eventId: number): Promise<LapCenterClass[]> {
  const file = await resolveResultsFile(eventId);
  const url = `${BASE_URL}/lapcombat2/index.jsp?event=${eventId}&file=${file}`;
  const res = await lcFetch(url, {
    headers: { "User-Agent": "trails.jp/1.0 (lapcenter sync)" },
    dispatcher: mulka2Dispatcher,
  });
  if (!res.ok) return [];

  const html = await res.text();
  const $ = cheerio.load(html);
  const classes: LapCenterClass[] = [];

  $("table.table-condensed tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 2) return;

    // クラス名: <b>MA</b>
    const className = tds.eq(0).find("b").first().text().trim();
    if (!className) return;

    // 距離: <span>4.0km</span>
    const distSpan = tds.eq(0).find("span").first().text().trim();
    const distance = distSpan || "";

    // classId: result-list.jsp?event=...&class=N のNを抽出
    const link = tds.eq(1).find('a[href*="class="]').first().attr("href") || "";
    const classMatch = link.match(/class=(\d+)/);
    if (!classMatch) return;

    classes.push({
      classId: parseInt(classMatch[1], 10),
      className,
      distance,
    });
  });

  return classes;
}

// ---------------------------------------------------------------------------
// split-list.jsp から全ランナーの巡航速度・ミス率を取得
// ---------------------------------------------------------------------------

export async function fetchSplitList(
  eventId: number,
  classId: number
): Promise<LapCenterRunnerStat[]> {
  const file = await resolveResultsFile(eventId);
  const url = `${BASE_URL}/lapcombat2/split-list.jsp?event=${eventId}&file=${file}&class=${classId}`;
  const res = await lcFetch(url, {
    headers: { "User-Agent": "trails.jp/1.0 (lapcenter sync)" },
    dispatcher: mulka2Dispatcher,
  });
  if (!res.ok) return [];

  const html = await res.text();
  const runners: LapCenterRunnerStat[] = [];

  // JS 埋め込みデータをパース: runnerData['key'] = 'value'; ... runnerList.push(runnerData);
  const blocks = html.split("runnerList.push(runnerData);");
  for (const block of blocks) {
    const get = (key: string): string => {
      const m = block.match(new RegExp(`runnerData\\['${key}'\\]\\s*=\\s*'([^']*)';`));
      return m ? m[1] : "";
    };

    const name = get("runnerName");
    if (!name) continue;

    const speedStr = get("speed");
    const lossRateStr = get("lossRate");
    const speed = parseFloat(speedStr);
    const missRate = parseFloat(lossRateStr);
    if (isNaN(speed) || isNaN(missRate)) continue;

    const rankStr = get("rank");
    const rank = parseInt(rankStr, 10);
    if (isNaN(rank)) continue; // MP/DISQ/DNS はスキップ

    runners.push({
      name,
      club: get("clubName"),
      rank,
      result: get("result"),
      speed,
      missRate,
    });
  }

  return runners;
}

// ---------------------------------------------------------------------------
// split-list.jsp から全ランナーの per-leg 詳細（全配列）を取得（relay-first）
// 既存 fetchSplitList（集計2値のみ）は破棄せず併存。詳細解析「結果分析」セクション用。
// パースは純関数 parseSplitListDetailed（lapcenter-detail.ts）に委譲。
// ---------------------------------------------------------------------------

export async function fetchSplitListDetailed(
  eventId: number,
  classId: number
) {
  const file = await resolveResultsFile(eventId);
  const url = `${BASE_URL}/lapcombat2/split-list.jsp?event=${eventId}&file=${file}&class=${classId}`;
  const res = await lcFetch(url, {
    headers: { "User-Agent": "trails.jp/1.0 (lapcenter sync)" },
    dispatcher: mulka2Dispatcher,
  });
  if (!res.ok) return [];

  const html = await res.text();
  return parseSplitListDetailed(html);
}
