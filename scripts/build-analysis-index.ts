/**
 * 全ランキング JSON を読み込み、athlete-index.json と club-stats.json を生成。
 * athlete-index.json は軽量版（イベント詳細なし）で高速ロード向け。
 * Usage: npx tsx scripts/build-analysis-index.ts
 */
import * as fs from "fs";
import * as path from "path";
import { splitAffiliations } from "../src/lib/club-normalize";
import { computeWeekendPoints } from "../src/lib/weekend-points";
import { jstNowLabel, jstToday } from "../src/lib/weekend-window";
import { eventFuzzyMatch } from "../src/lib/analysis/event-match";
import { buildCrossRaceIndex, type LcRaceRow } from "../src/lib/analysis/cross-race";
import { buildLegFingerprintIndex, detectHomonymKeys, type TrackedLegRow, type CompanionRow } from "../src/lib/analysis/leg-fingerprint";

// --- Types ---
interface RawEntry {
  rank: number;
  athlete_name: string;
  club: string;
  total_points: number;
  is_active: boolean;
  event_scores: { event_name: string; points: number }[];
}

interface RankingRef {
  type: string;
  className: string;
  rank: number;
  totalPoints: number;
  isActive: boolean;
}

interface AthleteSummary {
  name: string;
  clubs: string[];
  appearances: RankingRef[];
  bestRank: number;
  avgTotalPoints: number;
  forestCount: number;
  sprintCount: number;
  type: "sprinter" | "forester" | "allrounder" | "unknown";
  recentForm: number;
  raceCount: number; // 重複排除済みの出場大会数（種目合算）
}

interface ClubMember {
  name: string;
  bestRank: number;
  avgTotalPoints: number;
  rankingType: string;
  className: string;
  athleteType: "sprinter" | "forester" | "allrounder" | "unknown";
  isActive: boolean;
  categoryCount: number;
  recentForm: number;
  consistency: number;
  eventCount: number;
}

interface ClubProfile {
  name: string;
  memberCount: number;
  activeCount: number;
  avgPoints: number;
  members: ClubMember[];
  forestCount: number;
  sprintCount: number;
  delta?: {
    memberCount: { mom: number | null; yoy: number | null };
    activeCount: { mom: number | null; yoy: number | null };
    avgPoints: { mom: number | null; yoy: number | null };
  };
}

// --- Helpers ---
/**
 * 年齢別無差別カテゴリの totalPoints を z-score で正規化して特性を判定。
 * 母集団の平均・標準偏差で正規化し、z-score 差が 0.3 以上で分類。
 * 両方の無差別カテゴリに出場 → z-score 比較。
 * 片方のみ出場 → その種目に分類。
 * どちらも未出場 → appearances の forestCount/sprintCount で判定。
 */
function classifyType(
  appearances: RankingRef[],
  popStats: { forestMean: number; forestStd: number; sprintMean: number; sprintStd: number },
): AthleteSummary["type"] {
  const isFemale = appearances.some((r) => r.className === "女子無差別" || r.className === "S_女子無差別");
  const fClass = isFemale ? "女子無差別" : "無差別";
  const sClass = isFemale ? "S_女子無差別" : "S_無差別";
  const fApp = appearances.find((r) => r.type === "age_forest" && r.className === fClass);
  const sApp = appearances.find((r) => r.type === "age_sprint" && r.className === sClass);

  if (fApp && sApp) {
    const fZ = (fApp.totalPoints - popStats.forestMean) / popStats.forestStd;
    const sZ = (sApp.totalPoints - popStats.sprintMean) / popStats.sprintStd;
    const diff = fZ - sZ;
    if (diff > 0.3) return "forester";
    if (diff < -0.3) return "sprinter";
    return "allrounder";
  }
  if (fApp) return "forester";
  if (sApp) return "sprinter";

  // 無差別カテゴリなし → appearances の種目で判定
  const hasForest = appearances.some((r) => r.type.includes("forest"));
  const hasSprint = appearances.some((r) => r.type.includes("sprint"));
  if (hasForest && !hasSprint) return "forester";
  if (hasSprint && !hasForest) return "sprinter";
  if (hasForest && hasSprint) return "allrounder";
  return "unknown";
}

function parseFilename(file: string): { type: string; className: string } | null {
  const base = file.replace(".json", "");
  const prefixes = ["elite_forest_", "elite_sprint_", "age_forest_", "age_sprint_"];
  for (const prefix of prefixes) {
    if (base.startsWith(prefix)) {
      return {
        type: prefix.slice(0, -1), // remove trailing _
        className: base.slice(prefix.length),
      };
    }
  }
  return null;
}


// --- Main ---
const RANKINGS_DIR = path.resolve(__dirname, "../public/data/rankings");
const OUTPUT_DIR = path.resolve(__dirname, "../public/data");

interface ParsedEvent {
  date: string;
  eventName: string;
  points: number;
  discipline: "forest" | "sprint";
}

const athleteMap = new Map<string, {
  clubs: Set<string>;
  appearances: RankingRef[];
  allEvents: ParsedEvent[]; // 全イベントスコア（重複排除前）
}>();

// --- 無差別4クラスをJOYから最新取得してJSON上書き ---
import * as cheerio from "cheerio";

// 全ランキングカテゴリを ranking-configs.json から導出してJOYから最新取得。
// （2026-05 以前は無差別4クラスのみ更新 → 全77カテゴリに拡張）
interface RankingClassRef { typeId: number; classId: number; file: string }
const ALL_CLASSES: RankingClassRef[] = (() => {
  const configPath = path.resolve(__dirname, "../src/data/ranking-configs.json");
  const configs: { type: string; typeId: number; classes: { id: number; name: string }[] }[] =
    JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const list: RankingClassRef[] = [];
  for (const t of configs) {
    for (const c of t.classes) {
      list.push({ typeId: t.typeId, classId: c.id, file: `${t.type}_${c.name}.json` });
    }
  }
  return list;
})();

function parsePage(html: string): RawEntry[] {
  const $ = cheerio.load(html);
  const entries: RawEntry[] = [];
  const eventHeaders: string[] = [];
  $("table thead th, table tr:first-child th").each((i, th) => {
    if (i > 3) eventHeaders.push($(th).text().trim());
  });
  $("table tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) return;
    const rank = parseInt(cells.eq(0).text().trim(), 10);
    if (isNaN(rank)) return;
    const athlete_name = cells.eq(1).text().trim();
    if (!athlete_name) return;
    const club = cells.eq(2).text().trim();
    const total_points = parseFloat(cells.eq(3).text().trim()) || 0;
    const rowClass = $(row).attr("class") ?? "";
    const is_active = !rowClass.includes("out_ranker");
    const event_scores: { event_name: string; points: number }[] = [];
    cells.each((i, cell) => {
      if (i > 3 && eventHeaders[i - 4]) {
        const pts = parseFloat($(cell).text().trim());
        if (!isNaN(pts) && pts > 0) event_scores.push({ event_name: eventHeaders[i - 4], points: pts });
      }
    });
    entries.push({ rank, athlete_name, club, total_points, is_active, event_scores });
  });
  return entries;
}

// 全カテゴリ取得時のビルド時間/JOY負荷の制御値（環境変数で上書き可）。
// 既定の並列度を 4→8 に引き上げてビルドを高速化。JOY がレート制限を返す/失敗が増える場合は
// BUILD_FETCH_CONCURRENCY=4 などに下げる（失敗カテゴリは既存ファイル保持なのでデータは壊れない）。
const envNum = (v: string | undefined, dflt: number): number => {
  const n = v != null ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : dflt;
};
const FETCH_CONCURRENCY = envNum(process.env.BUILD_FETCH_CONCURRENCY, 8);  // 同時取得カテゴリ数（旧既定4）
const REQUEST_DELAY_MS = envNum(process.env.BUILD_REQUEST_DELAY_MS, 120);  // 同一カテゴリ内のページ間スロットル（旧150）
const MAX_PAGES = envNum(process.env.BUILD_MAX_PAGES, 60);                 // 1カテゴリあたりページ数の安全上限

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ランキング表を含む正常応答かを判定（エラー/タイムアウト代替ページを弾く） */
function isValidRankingHtml(html: string): boolean {
  // JOYのランキングページは空クラスでも <table>（ヘッダ）を含む
  if (!/<table/i.test(html)) return false;
  if (/<title>[^<]*(40[0-9]|50[0-9]|Error|エラー|Not Found)/i.test(html)) return false;
  return true;
}

/** 1ページ分を取得（プロキシ → JOY直接）。失敗時は例外を投げる。 */
async function fetchRankingPageOnce(typeId: number, classId: number, page: number): Promise<string> {
  const secret = process.env.CRON_SECRET;

  // 1. プロキシ経由（Vercelビルド環境からJOY直接が失敗するため）
  if (secret) {
    try {
      const proxyUrl = `https://trailsjp.vercel.app/api/rankings/proxy?typeId=${typeId}&classId=${classId}&page=${page}`;
      const res = await fetch(proxyUrl, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const html = await res.text();
        if (isValidRankingHtml(html)) return html;
      }
    } catch { /* fall through to direct */ }
  }

  // 2. JOY直接（ローカルビルド時はこちらが成功する）
  const joyUrl = page === 0
    ? `https://japan-o-entry.com/ranking/ranking/ranking_index/${typeId}/${classId}`
    : `https://japan-o-entry.com/ranking/ranking/ranking_index/${typeId}/${classId}/${page}`;
  const res = await fetch(joyUrl, {
    headers: { "User-Agent": "trails.jp/1.0 (build sync)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${joyUrl}`);
  const html = await res.text();
  if (!isValidRankingHtml(html)) throw new Error(`invalid ranking HTML ${joyUrl}`);
  return html;
}

/**
 * 1ページ分のHTMLを取得。一時的なエラー（JOYの500等）に備え指数的バックオフでリトライする。
 * 全リトライ失敗時は例外を投げ、呼び出し側で「既存ファイル保持」に倒す。
 */
async function fetchRankingPage(typeId: number, classId: number, page: number): Promise<string> {
  const MAX_RETRIES = 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fetchRankingPageOnce(typeId, classId, page);
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES - 1) await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** 既存スコアのマージキー（同姓同名の衝突回避のため所属も含める） */
function scoreMergeKey(e: { athlete_name: string; club: string }): string {
  return `${e.athlete_name} ${e.club}`;
}

/**
 * 1カテゴリ分を全ページ取得してJSONを更新する。
 * いずれかのページ取得が失敗した場合は例外が伝播し、呼び出し側で既存ファイルを保持する（原子的更新）。
 * 戻り値は結果サマリ文字列。
 */
async function fetchCategory(cls: RankingClassRef): Promise<string> {
  const allFresh: RawEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let consecutiveFailures = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    let html: string;
    try {
      html = await fetchRankingPage(cls.typeId, cls.classId, page);
    } catch (e) {
      // 先頭ページの失敗はカテゴリ全体を中断（既存ファイル保持。途中順位から始まる不完全データを出さない）
      if (page === 0) throw e;
      // 中間ページの単発障害（JOY側の特定ページ500など）はスキップして次ページへ継続。
      // 連続失敗が続く場合のみ終端/恒久障害とみなして打ち切る（暴走防止）。
      skipped++;
      consecutiveFailures++;
      if (consecutiveFailures >= 3) break;
      continue;
    }
    consecutiveFailures = 0;

    const entries = parsePage(html);
    if (entries.length === 0) break; // 空ページ＝ページネーション終端

    let added = 0;
    for (const e of entries) {
      const key = `${e.rank}:${e.athlete_name}`;
      if (!seen.has(key)) {
        seen.add(key);
        allFresh.push(e);
        added++;
      }
    }
    if (added === 0) break;
    await sleep(REQUEST_DELAY_MS);
  }

  // 取得結果が空 → 既存ファイルを保持（空クラス or 一時的空応答でデータを消さない）
  if (allFresh.length === 0) return `${cls.file}: 0 entries (kept existing)`;

  // 既存データのイベントスコアをマージ（JOYは直近~1年分のみ返すため過去分を引き継ぐ）
  const filePath = path.join(RANKINGS_DIR, cls.file);
  let existing: RawEntry[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { /* first run */ }

  const existingScores = new Map<string, { event_name: string; points: number }[]>();
  for (const e of existing) {
    existingScores.set(scoreMergeKey(e), e.event_scores || []);
  }
  for (const entry of allFresh) {
    const oldScores = existingScores.get(scoreMergeKey(entry));
    if (oldScores && oldScores.length > 0) {
      const scoreMap = new Map<string, { event_name: string; points: number }>();
      for (const s of oldScores) scoreMap.set(s.event_name, s);
      for (const s of entry.event_scores) scoreMap.set(s.event_name, s);
      entry.event_scores = [...scoreMap.values()];
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(allFresh, null, 2));
  return `${cls.file}: ${allFresh.length} entries${skipped ? ` (${skipped} page(s) skipped on error)` : ""}`;
}

/** 全カテゴリを並列度を絞って取得。失敗カテゴリは既存ファイルを保持する。 */
async function fetchFreshRankings() {
  const t0 = Date.now();
  const queue = [...ALL_CLASSES];
  let updated = 0, kept = 0, failed = 0;

  async function worker() {
    for (;;) {
      const cls = queue.shift();
      if (!cls) return;
      try {
        const msg = await fetchCategory(cls);
        if (msg.includes("kept existing")) kept++; else updated++;
        console.log(` → ${msg}`);
      } catch (e) {
        failed++;
        console.warn(`  Failed ${cls.file}: keeping existing file (${(e as Error).message})`);
      }
    }
  }

  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, () => worker()));
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Rankings fetch done in ${elapsedSec}s (concurrency=${FETCH_CONCURRENCY}): ${updated} updated, ${kept} kept(empty), ${failed} failed(kept existing).`);
}

// --- メイン処理（async fetch後に同期処理を続行） ---
async function main() {

// SKIP_FETCH=1: JOY 再取得を丸ごとスキップ（ローカル既存 JSON で index/snapshot/movers 経路だけ回すドライラン用）
if (process.env.SKIP_FETCH === "1") {
  console.log("⚠ SKIP_FETCH=1: JOY 再取得をスキップし、ローカル既存 JSON を使用します");
} else {
  console.log(`Fetching fresh rankings from JOY (all ${ALL_CLASSES.length} categories, concurrency=${FETCH_CONCURRENCY})...`);
  await fetchFreshRankings().catch((e: unknown) => console.warn("Ranking fetch failed, using local files:", e));
}

// ランキング取得時刻を記録（ランキングページの「最終更新」表示用）。
// ビルド = 週次取得タイミングなので、ビルド時刻 ≒ データ取得時刻。
{
  const now = new Date();
  const generatedAtJst = now.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const metaPath = path.resolve(__dirname, "../src/data/rankings-meta.json");
  fs.writeFileSync(metaPath, JSON.stringify({ generatedAt: now.toISOString(), generatedAtJst }, null, 2));
  console.log(`✓ rankings-meta.json: ${generatedAtJst}`);
}

const files = fs.readdirSync(RANKINGS_DIR).filter((f) => f.endsWith(".json"));
console.log(`Reading ${files.length} ranking files...`);

function parseEventName(raw: string): { date: string; eventName: string } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+([\s\S]+)$/);
  if (match) return { date: match[1], eventName: match[2].trim() };
  return { date: "", eventName: trimmed };
}

for (const file of files) {
  const parsed = parseFilename(file);
  if (!parsed) {
    console.warn(`Unknown file pattern: ${file}, skipping`);
    continue;
  }
  const { type, className } = parsed;

  const raw: RawEntry[] = JSON.parse(
    fs.readFileSync(path.join(RANKINGS_DIR, file), "utf-8")
  );

  for (const entry of raw) {
    // スペース有無の表記ゆれを統一（例: "佐藤 遼平" → "佐藤遼平"）
    const key = entry.athlete_name.replace(/\s+/g, "");
    if (!athleteMap.has(key)) {
      athleteMap.set(key, { clubs: new Set(), appearances: [], allEvents: [] });
    }
    const data = athleteMap.get(key)!;

    if (entry.club && entry.club !== "-") {
      for (const cn of splitAffiliations(entry.club)) {
        data.clubs.add(cn);
      }
    }

    data.appearances.push({
      type,
      className,
      rank: entry.rank,
      totalPoints: entry.total_points,
      isActive: entry.is_active,
    });

    // イベントスコア収集
    const discipline: "forest" | "sprint" = type.includes("sprint") ? "sprint" : "forest";
    for (const es of entry.event_scores) {
      const { date, eventName } = parseEventName(es.event_name);
      if (date) {
        data.allEvents.push({ date, eventName, points: es.points, discipline });
      }
    }
  }
}

// 選手ごとのイベント重複排除 + 統計計算用ヘルパー
/** イベント名を正規化（末尾の「大会」を除去して名寄せ） */
function normalizeEventName(name: string): string {
  return name.replace(/大会$/, "").trim();
}

function dedupeEvents(events: ParsedEvent[]): ParsedEvent[] {
  const map = new Map<string, ParsedEvent>();
  for (const e of events) {
    const key = `${e.discipline}:${e.date}:${normalizeEventName(e.eventName)}`;
    const existing = map.get(key);
    if (!existing || e.points > existing.points) {
      map.set(key, e);
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function calcConsistency(events: ParsedEvent[]): number {
  if (events.length < 2) return 0;
  const pts = events.map((e) => e.points);
  const mean = pts.reduce((a, b) => a + b, 0) / pts.length;
  if (mean === 0) return 0;
  const variance = pts.reduce((s, p) => s + (p - mean) ** 2, 0) / pts.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.round(Math.max(0, Math.min(100, (1 - cv / 0.3) * 100)));
}

function calcRecentFormForDiscipline(events: ParsedEvent[]): number {
  if (events.length < 2) return 0;
  const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date));
  const recent = sorted.slice(0, 3);
  const recentAvg = recent.reduce((s, e) => s + e.points, 0) / recent.length;
  const allAvg = sorted.reduce((s, e) => s + e.points, 0) / sorted.length;
  if (allAvg === 0) return 0;
  return Math.round(((recentAvg - allAvg) / allAvg) * 100);
}

function calcRecentForm(events: ParsedEvent[], athleteType: AthleteSummary["type"]): number {
  const forest = events.filter((e) => e.discipline === "forest");
  const sprint = events.filter((e) => e.discipline === "sprint");

  if (athleteType === "forester") {
    return calcRecentFormForDiscipline(forest);
  }
  if (athleteType === "sprinter") {
    return calcRecentFormForDiscipline(sprint);
  }
  // allrounder / unknown: 両方計算して平均（片方しかなければそちらのみ）
  const fForm = calcRecentFormForDiscipline(forest);
  const sForm = calcRecentFormForDiscipline(sprint);
  if (fForm !== 0 && sForm !== 0) return Math.round((fForm + sForm) / 2);
  return fForm || sForm;
}

// 母集団統計を計算（z-score 正規化用: 年齢別無差別カテゴリの totalPoints）
const popForest: number[] = [];
const popSprint: number[] = [];
for (const data of athleteMap.values()) {
  const isFemale = data.appearances.some((r) => r.className === "女子無差別" || r.className === "S_女子無差別");
  const fClass = isFemale ? "女子無差別" : "無差別";
  const sClass = isFemale ? "S_女子無差別" : "S_無差別";
  const fApp = data.appearances.find((r) => r.type === "age_forest" && r.className === fClass);
  const sApp = data.appearances.find((r) => r.type === "age_sprint" && r.className === sClass);
  if (fApp) popForest.push(fApp.totalPoints);
  if (sApp) popSprint.push(sApp.totalPoints);
}
const popMean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
const popStd = (arr: number[]) => { const m = popMean(arr); return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length); };
const popStats = {
  forestMean: popMean(popForest), forestStd: popStd(popForest),
  sprintMean: popMean(popSprint), sprintStd: popStd(popSprint),
};

// Build AthleteSummary records
const athletes: Record<string, AthleteSummary> = {};
let athleteCount = 0;

for (const [name, data] of athleteMap) {
  const forestCount = data.appearances.filter((r) => r.type.includes("forest")).length;
  const sprintCount = data.appearances.filter((r) => r.type.includes("sprint")).length;
  const bestRank = Math.min(...data.appearances.map((r) => r.rank));

  // ポイント = 年齢別の無差別カテゴリ (Forest + Sprint) の平均
  // 女子選手は「女子無差別」を使用、男子は「無差別」を使用
  const isFemale = data.appearances.some((r) => r.className === "女子無差別" || r.className === "S_女子無差別");
  const openForestClass = isFemale ? "女子無差別" : "無差別";
  const openSprintClass = isFemale ? "S_女子無差別" : "S_無差別";
  const forestPts = data.appearances.find((r) => r.type === "age_forest" && r.className === openForestClass)?.totalPoints;
  const sprintPts = data.appearances.find((r) => r.type === "age_sprint" && r.className === openSprintClass)?.totalPoints;
  let avgTotalPoints: number;
  if (forestPts != null && sprintPts != null) {
    avgTotalPoints = Math.round(((forestPts + sprintPts) / 2) * 10) / 10;
  } else {
    avgTotalPoints = forestPts ?? sprintPts ?? Math.max(...data.appearances.map((r) => r.totalPoints));
  }

  athletes[name] = {
    name,
    clubs: [...data.clubs],
    appearances: data.appearances,
    bestRank,
    avgTotalPoints,
    forestCount,
    sprintCount,
    type: classifyType(data.appearances, popStats),
    recentForm: 0,
    raceCount: 0,
  };
  athleteCount++;
}

// Build ClubProfile records
// 選手ごとの統計情報をキャッシュ
const athleteStats = new Map<string, {
  events: ParsedEvent[];
  recentForm: number;
  consistency: number;
}>();

for (const [name, data] of athleteMap) {
  const events = dedupeEvents(data.allEvents);
  const athleteType = athletes[name]?.type ?? "unknown";
  athleteStats.set(name, {
    events,
    recentForm: calcRecentForm(events, athleteType),
    consistency: calcConsistency(events),
  });
}

// recentForm / raceCount を athletes に後付け
for (const [name, stats] of athleteStats) {
  if (athletes[name]) {
    athletes[name].recentForm = stats.recentForm;
    athletes[name].raceCount = stats.events.length;
  }
}

const clubMap = new Map<string, {
  members: Map<string, ClubMember>;
  forestCount: number;
  sprintCount: number;
}>();

for (const profile of Object.values(athletes)) {
  for (const club of profile.clubs) {
    if (!clubMap.has(club)) {
      clubMap.set(club, { members: new Map(), forestCount: 0, sprintCount: 0 });
    }
    const c = clubMap.get(club)!;

    if (!c.members.has(profile.name)) {
      const bestApp = profile.appearances.reduce((best, r) =>
        r.rank < best.rank ? r : best
      );
      const stats = athleteStats.get(profile.name);
      c.members.set(profile.name, {
        name: profile.name,
        bestRank: profile.bestRank,
        avgTotalPoints: profile.avgTotalPoints,
        rankingType: bestApp.type,
        className: bestApp.className,
        athleteType: profile.type,
        isActive: (() => {
          // アクティブ = 直近6か月以内にランキング対象イベントへの参加記録がある選手
          const cutoff = new Date();
          cutoff.setMonth(cutoff.getMonth() - 6);
          const cutoffStr = cutoff.toISOString().slice(0, 10);
          const events = athleteStats.get(profile.name)?.events ?? [];
          return events.some((e) => e.date >= cutoffStr);
        })(),
        categoryCount: profile.appearances.length,
        recentForm: stats?.recentForm ?? 0,
        consistency: stats?.consistency ?? 0,
        eventCount: stats?.events.length ?? 0,
      });
    }

    c.forestCount += profile.forestCount;
    c.sprintCount += profile.sprintCount;
  }
}

const clubs: Record<string, ClubProfile> = {};
for (const [name, data] of clubMap) {
  const memberList = [...data.members.values()].sort((a, b) => b.avgTotalPoints - a.avgTotalPoints);
  const activeCount = memberList.filter((m) => m.isActive).length;
  const avgPoints =
    memberList.length > 0
      ? memberList.reduce((s, m) => s + m.avgTotalPoints, 0) / memberList.length
      : 0;

  clubs[name] = {
    name,
    memberCount: memberList.length,
    activeCount,
    avgPoints: Math.round(avgPoints * 10) / 10,
    members: memberList,
    forestCount: data.forestCount,
    sprintCount: data.sprintCount,
  };
}

// ---- クラブ統計の前月比・前年比算出 ----
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (supabaseUrl && supabaseKey) {
  try {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const prevMonth = (() => {
      // 月初1日固定で前月を求める（setMonth は 29〜31日に翌月へロールオーバーする）
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();
    const prevYear = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // 現月スナップショットを保存
    const snapshot: Record<string, { m: number; a: number; p: number }> = {};
    for (const [name, club] of Object.entries(clubs)) {
      snapshot[name] = { m: club.memberCount, a: club.activeCount, p: club.avgPoints };
    }
    const headers = {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    };
    // on_conflict 指定で同月2回目以降のビルドも upsert（未指定だと 409 無音失敗で月初値が凍結される）
    const clubSnapRes = await fetch(`${supabaseUrl}/rest/v1/club_stats_snapshot?on_conflict=month`, {
      method: "POST",
      headers,
      body: JSON.stringify({ month: currentMonth, stats: snapshot }),
    });
    if (!clubSnapRes.ok) {
      console.warn(`⚠ club_stats_snapshot upsert failed: HTTP ${clubSnapRes.status} (1 row)`);
    }

    // 前月・前年のスナップショットを取得
    const fetchSnapshot = async (month: string) => {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/club_stats_snapshot?month=eq.${month}&select=stats`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
      );
      const rows = await res.json() as { stats: Record<string, { m: number; a: number; p: number }> }[];
      return rows[0]?.stats ?? null;
    };
    const [prevMonthStats, prevYearStats] = await Promise.all([
      fetchSnapshot(prevMonth),
      fetchSnapshot(prevYear),
    ]);

    // delta算出
    for (const [name, club] of Object.entries(clubs)) {
      const pm = prevMonthStats?.[name];
      const py = prevYearStats?.[name];
      club.delta = {
        memberCount: {
          mom: pm ? club.memberCount - pm.m : null,
          yoy: py ? club.memberCount - py.m : null,
        },
        activeCount: {
          mom: pm ? club.activeCount - pm.a : null,
          yoy: py ? club.activeCount - py.a : null,
        },
        avgPoints: {
          mom: pm ? Math.round((club.avgPoints - pm.p) * 10) / 10 : null,
          yoy: py ? Math.round((club.avgPoints - py.p) * 10) / 10 : null,
        },
      };
    }
    console.log(`✓ club deltas: mom=${prevMonthStats ? "yes" : "no data"}, yoy=${prevYearStats ? "yes" : "no data"}`);
  } catch (e) {
    console.warn("Club snapshot/delta failed:", e);
  }
} else {
  console.warn("⚠ Supabase not configured, skipping club deltas");
}

// ---- ランキング順位・ポイントの前月比・前年比算出（全クラス対象） ----

if (supabaseUrl && supabaseKey) {
  try {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const prevMonth = (() => {
      // 月初1日固定で前月を求める（setMonth は 29〜31日に翌月へロールオーバーする）
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();
    const prevYear = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const sbHeaders = {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    };

    // 前月・前年のスナップショットを月ごとに1リクエストで取得し、file_key で引けるようにする
    const fetchMonthSnapshots = async (
      month: string,
    ): Promise<Map<string, Record<string, { r: number; p: number }>> | null> => {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/ranking_snapshot?month=eq.${month}&select=file_key,stats`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
      );
      if (!res.ok) {
        console.warn(`⚠ ranking_snapshot fetch failed: month=${month} HTTP ${res.status}`);
        return null;
      }
      const rows = await res.json() as { file_key: string; stats: Record<string, { r: number; p: number }> }[];
      // 取得件数を必ずログに出す（無言全滅の防止）
      console.log(`✓ ranking_snapshot ${month}: ${rows.length} rows`);
      return new Map(rows.map((r) => [r.file_key, r.stats]));
    };
    const [pmMonthMap, pyMonthMap] = await Promise.all([
      fetchMonthSnapshots(prevMonth),
      fetchMonthSnapshots(prevYear),
    ]);

    // 存在する全ランキングファイルを対象に (a) スナップショット行構築 (b) delta 付与
    const snapshotRows: { month: string; file_key: string; stats: Record<string, { r: number; p: number }> }[] = [];
    for (const fileName of files) {
      const parsed = parseFilename(fileName);
      if (!parsed) continue;
      const filePath = path.join(RANKINGS_DIR, fileName);
      const entries: RawEntry[] = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const fileKey = fileName.replace(".json", "");

      // 同姓同名ガード: 同一ファイル内に同じ athlete_name が2件以上ある名前は
      // スナップショット格納・delta 付与の両方からスキップ（後勝ち上書きによる捏造 delta の根絶）
      const nameCounts = new Map<string, number>();
      for (const e of entries) {
        nameCounts.set(e.athlete_name, (nameCounts.get(e.athlete_name) ?? 0) + 1);
      }
      const dupNames = new Set([...nameCounts].filter(([, c]) => c >= 2).map(([n]) => n));

      // スナップショット保存: { "選手名": { r: rank, p: total_points } }
      const snap: Record<string, { r: number; p: number }> = {};
      for (const e of entries) {
        if (dupNames.has(e.athlete_name)) continue;
        snap[e.athlete_name] = { r: e.rank, p: e.total_points };
      }
      snapshotRows.push({ month: currentMonth, file_key: fileKey, stats: snap });

      // delta 付与（前月・前年はメモリ上の月別マップから file_key 引き）
      const pmSnap = pmMonthMap?.get(fileKey) ?? null;
      const pySnap = pyMonthMap?.get(fileKey) ?? null;
      let deltaCount = 0;
      for (const e of entries) {
        // 過去ビルドが書き込んだ stale な delta（同姓同名の捏造値を含む）を一旦除去してから再計算
        delete (e as any).rank_delta;
        delete (e as any).points_delta;
        if (dupNames.has(e.athlete_name)) continue;
        const pm = pmSnap?.[e.athlete_name];
        const py = pySnap?.[e.athlete_name];
        if (pm || py) {
          (e as any).rank_delta = {
            mom: pm ? pm.r - e.rank : null,  // 前月より順位が上がった→正の値
            yoy: py ? py.r - e.rank : null,
          };
          (e as any).points_delta = {
            mom: pm ? Math.round((e.total_points - pm.p) * 10) / 10 : null,
            yoy: py ? Math.round((e.total_points - py.p) * 10) / 10 : null,
          };
          deltaCount++;
        }
      }
      fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
      if (deltaCount > 0) console.log(`✓ ranking deltas: ${fileKey} (${deltaCount} athletes)`);
    }

    // スナップショット書き込み: 20行ずつ分割バルク POST（on_conflict 指定で同月再ビルドも upsert）
    const SNAPSHOT_BATCH_SIZE = 20;
    let upsertFailures = 0;
    for (let i = 0; i < snapshotRows.length; i += SNAPSHOT_BATCH_SIZE) {
      const batch = snapshotRows.slice(i, i + SNAPSHOT_BATCH_SIZE);
      const res = await fetch(`${supabaseUrl}/rest/v1/ranking_snapshot?on_conflict=month,file_key`, {
        method: "POST",
        headers: sbHeaders,
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        upsertFailures++;
        console.warn(`⚠ ranking_snapshot upsert failed: HTTP ${res.status} (${batch.length} rows, offset ${i})`);
      }
    }
    if (upsertFailures === 0) {
      console.log(`✓ ranking_snapshot: ${snapshotRows.length} files upserted for ${currentMonth}`);
    }
  } catch (e) {
    console.warn("Ranking snapshot/delta failed:", e);
  }
} else {
  console.warn("⚠ Supabase not configured, skipping ranking deltas");
}

// ---- weekend-points.json 生成（トップページ上「ポイント上昇度」用） ----
// athleteMap から純関数の入力を構築し、直近土日祝クラスタの自己平均超え delta を算出。
{
  const wpInput = [...athleteMap].map(([key, d]) => ({
    key,
    club: [...d.clubs][0] ?? "",
    events: dedupeEvents(d.allEvents).map((e) => ({
      date: e.date,
      eventName: e.eventName,
      points: e.points,
      discipline: e.discipline,
    })),
  }));
  const wp = computeWeekendPoints(wpInput, jstToday());
  fs.writeFileSync(
    path.resolve(__dirname, "../src/data/weekend-points.json"),
    JSON.stringify(
      { generatedAtJst: jstNowLabel() + " JST", targetDates: wp.targetDates, items: wp.items },
      null,
      2,
    ) + "\n",
  );
  console.log(`✓ weekend-points.json: ${wp.items.length} items (target ${wp.targetDates.join(",")})`);
  if (wp.items.length === 0) {
    console.warn("⚠ weekend-points.json: 0 items (直近の土日祝にランキング対象大会データ無し? 窓/鮮度を確認)");
  }
}

// Write output
const athleteIndex = { athletes, generatedAt: new Date().toISOString() };
const clubIndex = { clubs, generatedAt: new Date().toISOString() };

const athleteJson = JSON.stringify(athleteIndex);
const clubJson = JSON.stringify(clubIndex);

fs.writeFileSync(path.join(OUTPUT_DIR, "athlete-index.json"), athleteJson);
fs.writeFileSync(path.join(OUTPUT_DIR, "club-stats.json"), clubJson);

console.log(`✓ athlete-index.json: ${athleteCount} athletes (${(athleteJson.length / 1024).toFixed(0)} KB)`);
console.log(`✓ club-stats.json: ${clubMap.size} clubs (${(clubJson.length / 1024).toFixed(0)} KB)`);

// ---- race_type バックフィル（JOY ランキングの種目を正として lc_performances を補正） ----
// lc_performances.race_type はイベント名キーワード由来で誤判定があるため、ビルド毎に
// JOY ランキングの種目で自己修復する。完全隔離（例外でビルドを止めない）。
async function backfillRaceTypeFromJoy(): Promise<void> {
  if (!supabaseUrl || !supabaseKey) {
    console.warn("⚠ race_type backfill: Supabase 未設定のためスキップ");
    return;
  }
  const sbHeaders = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
  };

  // 1) JOY 種目マップ: date → { forest: 正規化名 Set, sprint: 正規化名 Set }
  const normKey = (name: string) => normalizeEventName(name).replace(/\s+/g, "");
  const joyByDate = new Map<string, { forest: Set<string>; sprint: Set<string> }>();
  for (const data of athleteMap.values()) {
    for (const e of dedupeEvents(data.allEvents)) {
      if (!e.date) continue;
      let byDate = joyByDate.get(e.date);
      if (!byDate) {
        byDate = { forest: new Set<string>(), sprint: new Set<string>() };
        joyByDate.set(e.date, byDate);
      }
      byDate[e.discipline].add(normKey(e.eventName));
    }
  }

  // 2) 現 lc 大会一覧（distinct）を RPC で取得
  const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/lc_distinct_events`, {
    method: "POST",
    headers: sbHeaders,
    body: JSON.stringify({}),
  });
  if (!rpcRes.ok) {
    console.warn(`⚠ race_type backfill: lc_distinct_events RPC 失敗 HTTP ${rpcRes.status} → スキップ`);
    return;
  }
  const lcEvents = (await rpcRes.json()) as { event_date: string; event_name: string; race_type: string }[];

  // 3) 各 lc 大会の desired 種目を判定
  const changes: { date: string; name: string; from: string; to: string }[] = [];
  for (const lc of lcEvents) {
    const byDate = joyByDate.get(lc.event_date);
    if (!byDate) continue; // JOY に当日データ無し → キーワード判定を尊重
    const hasF = byDate.forest.size > 0;
    const hasS = byDate.sprint.size > 0;

    let desired: "forest" | "sprint" | null = null;
    if (hasF && !hasS) desired = "forest";
    else if (hasS && !hasF) desired = "sprint";
    else if (hasF && hasS) {
      // 両種目あり → 名前で曖昧一致した方を採用
      const lcKey = normKey(lc.event_name);
      const matchF = [...byDate.forest].some((n) => eventFuzzyMatch(lcKey, n));
      const matchS = [...byDate.sprint].some((n) => eventFuzzyMatch(lcKey, n));
      if (matchF && !matchS) desired = "forest";
      else if (matchS && !matchF) desired = "sprint";
      // 両方マッチ or 不一致 → skip（曖昧すぎる）
    }
    if (!desired) continue;
    if (desired !== lc.race_type) {
      changes.push({ date: lc.event_date, name: lc.event_name, from: lc.race_type, to: desired });
    }
  }

  if (changes.length === 0) {
    console.log("✓ race_type backfill: 変更対象なし（lc と JOY 種目が一致）");
    return;
  }

  // 4) 暴走ガード: 80 件超は適用せず警告して終了（DB 非変更）
  if (changes.length > 80) {
    console.warn(`⚠ race_type backfill: 変更対象 ${changes.length} 件 (>80) のため適用中止（DB 非変更）`);
    return;
  }

  // 5) 適用（大会単位で PATCH）。lc_leg_splits にも同じ訂正を反映する
  //    （per-leg 行の race_type も isSprint キーワード由来のため同じ誤分類を持つ）。
  let applied = 0;
  for (const c of changes) {
    const url =
      `${supabaseUrl}/rest/v1/lc_performances` +
      `?event_date=eq.${c.date}&event_name=eq.${encodeURIComponent(c.name)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: { ...sbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ race_type: c.to }),
    });
    if (res.ok) {
      applied++;
      console.log(`✓ race_type: ${c.date} ${c.name} ${c.from}→${c.to}`);
    } else {
      console.warn(`⚠ race_type PATCH 失敗 HTTP ${res.status}: ${c.date} ${c.name}`);
    }

    const legUrl =
      `${supabaseUrl}/rest/v1/lc_leg_splits` +
      `?event_date=eq.${c.date}&event_name=eq.${encodeURIComponent(c.name)}`;
    const legRes = await fetch(legUrl, {
      method: "PATCH",
      headers: { ...sbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ race_type: c.to }),
    });
    if (!legRes.ok) {
      console.warn(`⚠ race_type PATCH(lc_leg_splits) 失敗 HTTP ${legRes.status}: ${c.date} ${c.name}`);
    }
  }
  console.log(`✓ race_type backfill: ${applied}/${changes.length} 件適用`);
}

try {
  await backfillRaceTypeFromJoy();
} catch (e) {
  console.warn("⚠ race_type backfill 例外（ビルドは継続）:", (e as Error).message);
}

// ---- クロスレース縦断 Stage 1（同水準巡航速度帯のミス残差） ----
// backfillRaceTypeFromJoy の後に実行（補正済み race_type で集計するため）。
// 失敗/env 欠如時は既存の cross-race.json を保持（無ければ空スケルトン）してビルド継続。
async function buildCrossRaceStep(homonymKeys: Set<string> | null): Promise<void> {
  const outPath = path.join(OUTPUT_DIR, "cross-race.json");
  const keepOrSkeleton = (why: string) => {
    console.warn(`⚠ cross-race: ${why}（${fs.existsSync(outPath) ? "既存ファイル保持" : "空スケルトン生成"}）`);
    if (!fs.existsSync(outPath)) {
      fs.writeFileSync(outPath, JSON.stringify(buildCrossRaceIndex([])));
    }
  };
  if (!supabaseUrl || !supabaseKey) {
    keepOrSkeleton("Supabase 未設定のためスキップ");
    return;
  }

  const rows: LcRaceRow[] = [];
  // PostgREST は max-rows（既定 1000）で 1 リクエストの返却行数をキャップし、Range をそれ以上に
  // 広げても黙って切り詰める。「返却 < 要求」での終了判定はキャップ到達を末尾と誤認する
  // （2026-07-06 本番で 25k 行中 1,000 行しか読めず artifact が 50 選手に縮んだ実障害）
  // → 終了判定は「空ページ」のみとし、前進幅は実返却行数にする（キャップ値に依存しない）。
  const PAGE = 10000;
  const MAX_REQUESTS = 200; // 異常時の無限ループ防止（200万行相当・十分な上限）
  let from = 0;
  for (let i = 0; i < MAX_REQUESTS; i++) {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/lc_performances` +
        `?select=athlete_name,event_date,event_name,cruising_speed,miss_rate,race_type` +
        `&order=athlete_name.asc,event_date.asc,event_name.asc`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Range: `${from}-${from + PAGE - 1}`,
        },
      },
    );
    if (!res.ok) {
      keepOrSkeleton(`lc_performances 取得失敗 HTTP ${res.status}`);
      return;
    }
    const page = (await res.json()) as {
      athlete_name: string;
      event_date: string;
      event_name: string;
      cruising_speed: number | string | null;
      miss_rate: number | string | null;
      race_type: string | null;
    }[];
    if (page.length === 0) break;
    for (const r of page) {
      if (r.race_type !== "forest" && r.race_type !== "sprint") continue;
      const speed = Number(r.cruising_speed);
      const miss = Number(r.miss_rate);
      if (!Number.isFinite(speed) || !Number.isFinite(miss)) continue;
      rows.push({
        name: r.athlete_name,
        date: r.event_date,
        event: r.event_name,
        speed,
        miss,
        type: r.race_type,
      });
    }
    from += page.length;
  }

  // 全件取得の健全性ガード: キャップ1枚分などの明らかな不足時は不完全な artifact で上書きしない
  if (rows.length < 5000) {
    keepOrSkeleton(`取得行数が異常に少ない (${rows.length} 行) — 不完全データでの上書きを回避`);
    return;
  }

  // 同姓同名（物理的重複を検出した名前）は leg-fingerprint ステップと同一基準で集計から除外
  const filtered = homonymKeys ? rows.filter((r) => !homonymKeys.has(r.name.replace(/\s+/g, ""))) : rows;
  if (homonymKeys && filtered.length < rows.length) {
    console.log(`  cross-race: 同姓同名 ${rows.length - filtered.length} 行を除外`);
  }

  const index = { ...buildCrossRaceIndex(filtered), generatedAt: new Date().toISOString() };
  const json = JSON.stringify(index);
  fs.writeFileSync(outPath, json);
  console.log(
    `✓ cross-race.json: F=${index.disciplines.forest?.athletes ?? 0} / S=${index.disciplines.sprint?.athletes ?? 0} 選手・` +
      `入力 ${rows.length} 行 (${(json.length / 1024).toFixed(0)} KB)`,
  );
}
// ---- Stage 2b: ミスの傾向（クロスレース指紋）＋トレンド重み ----
// lc_leg_splits（per-leg relay 値）から選手ごとの指紋 artifact を生成する。
// 転送削減のため2本の pruned select（tracked 行=統計用 / untracked 行=パック companion 用）。
async function buildLegFingerprintStep(): Promise<Set<string> | null> {
  const outPath = path.join(OUTPUT_DIR, "leg-fingerprint.json");
  const keepOrSkeleton = (why: string) => {
    console.warn(`⚠ leg-fingerprint: ${why}（${fs.existsSync(outPath) ? "既存ファイル保持" : "空スケルトン生成"}）`);
    if (!fs.existsSync(outPath)) {
      fs.writeFileSync(outPath, JSON.stringify(buildLegFingerprintIndex([], [])));
    }
  };
  if (!supabaseUrl || !supabaseKey) {
    keepOrSkeleton("Supabase 未設定のためスキップ");
    return null;
  }

  // #33 イディオム: 空ページのみ終了・前進幅=実返却行数（PostgREST max-rows キャップ耐性）
  const pageAll = async <T>(pathAndQuery: string): Promise<T[] | null> => {
    const rows: T[] = [];
    const PAGE = 10000;
    const MAX_REQUESTS = 300;
    let from = 0;
    for (let i = 0; i < MAX_REQUESTS; i++) {
      const res = await fetch(`${supabaseUrl}/rest/v1/${pathAndQuery}`, {
        headers: {
          apikey: supabaseKey!,
          Authorization: `Bearer ${supabaseKey}`,
          Range: `${from}-${from + PAGE - 1}`,
        },
      });
      if (!res.ok) return null;
      const page = (await res.json()) as T[];
      if (page.length === 0) break;
      rows.push(...page);
      from += page.length;
    }
    return rows;
  };

  const order = "&order=lc_event_id.asc,lc_class_id.asc,runner_index.asc";
  const tracked = await pageAll<TrackedLegRow>(
    "lc_leg_splits?tracked=is.true&select=runner_key,event_date,event_name,class_name,club,race_type,rank,speed,start_time,lap_sec,leg_loss_sec,leg_speed,elapsed_sec,lc_event_id,lc_class_id" + order
  );
  if (!tracked) {
    keepOrSkeleton("tracked 行の取得失敗");
    return null;
  }
  const companions = await pageAll<CompanionRow>(
    "lc_leg_splits?tracked=is.false&select=lc_event_id,lc_class_id,runner_index,start_time,elapsed_sec" + order
  );
  if (!companions) {
    keepOrSkeleton("companion 行の取得失敗");
    return null;
  }
  // 健全性ガード: 明らかな不足（キャップ1枚分等）で良品を上書きしない
  if (tracked.length < 40000) {
    keepOrSkeleton(`tracked 行数が異常に少ない (${tracked.length}) — 不完全データでの上書きを回避`);
    return null;
  }

  // 期間比較の境界＝ビルド時点の12ヶ月前（"recent" = event_date ≥ これ）
  const cut = new Date();
  cut.setFullYear(cut.getFullYear() - 1);
  const periodCutoff = cut.toISOString().slice(0, 10);
  const index = {
    ...buildLegFingerprintIndex(tracked, companions, { periodCutoff }),
    generatedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(index);
  fs.writeFileSync(outPath, json);
  const nAth = Object.keys(index.athletes).length;
  console.log(
    `✓ leg-fingerprint.json: 選手 ${nAth}・同姓同名除外 ${index.homonymExcluded ?? 0} 名・` +
      `入力 tracked=${tracked.length}/companion=${companions.length} 行 (${(json.length / 1024).toFixed(0)} KB)`
  );
  // cross-race 側でも同一基準で除外できるよう検出名を返す
  return detectHomonymKeys(tracked);
}
let homonymKeys: Set<string> | null = null;
try {
  homonymKeys = await buildLegFingerprintStep();
} catch (e) {
  console.warn("⚠ leg-fingerprint 生成例外（ビルドは継続）:", (e as Error).message);
}
try {
  await buildCrossRaceStep(homonymKeys);
} catch (e) {
  console.warn("⚠ cross-race 生成例外（ビルドは継続）:", (e as Error).message);
}

} // end main()
main().catch((e) => { console.error(e); process.exit(1); });
