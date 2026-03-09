/**
 * 全ランキング JSON を読み込み、athlete-index.json と club-stats.json を生成。
 * athlete-index.json は軽量版（イベント詳細なし）で高速ロード向け。
 * Usage: npx tsx scripts/build-analysis-index.ts
 */
import * as fs from "fs";
import * as path from "path";

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

/**
 * クラブ名の名寄せ (正規化)
 * 1. 大学OLC略称 → 正式大学名 (京大OLC → 京都大学)
 * 2. 大学大学院・大学院 → 大学
 * 3. 大学+末尾数字 → 大学 (京都大学3 → 京都大学)
 * 4. 末尾スペース+数字除去
 * 5. OLクラブ → OLC, olc → OLC
 */
function normalizeClubName(raw: string): string {
  let name = raw.trim();

  // --- 0. 全角英数字→半角に統一 ---
  name = name.replace(/[\uFF21-\uFF3A]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF21 + 0x41));
  name = name.replace(/[\uFF41-\uFF5A]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF41 + 0x61));
  name = name.replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30));

  // --- 0b. 大文字小文字の事前統一 ---
  name = name.replace(/olc/gi, "OLC");

  // --- 1. 大学OLC略称の明示的マッピング ---
  const universityMap: Record<string, string> = {
    "京大OLC": "京都大学",
    "北大OLC": "北海道大学",
    "千葉大OLC": "千葉大学",
    "東北大OLC": "東北大学",
    "東北大学OLC": "東北大学",
    "広大OLC": "広島大学",
    "阪大OLC": "大阪大学",
    "大阪大学OLC": "大阪大学",
    "金大OLC": "金沢大学",
    "金大OLC44期": "金沢大学",
    "岩手大学OLC": "岩手大学",
    "京女OLC": "京都女子大学",
    "奈良女OLC": "奈良女子大学",
    "同志社OLC": "同志社大学",
    "立命OLC": "立命館大学",
    "立命館OLC": "立命館大学",
    "神大OLC": "神戸大学",
    "神大大学4": "神戸大学",
    "東大大学院": "東京大学",
    "新潟大学OC1年": "新潟大学",
    "HUOLC": "北海道大学",
    "阪大30期": "大阪大学",
    "阪大2011入学": "大阪大学",
  };
  if (universityMap[name]) return universityMap[name];

  // --- 2. 大学院系の正規化 ---
  // "京都大学大学院" → "京都大学", "大阪大学大学院4" → "大阪大学"
  name = name.replace(/大学大学院\d*$/, "大学");
  // "筑波大学院" → "筑波大学", "名古屋大学院4" → "名古屋大学"
  name = name.replace(/(..+大)学院\d*$/, "$1学");

  // --- 3. 大学+末尾数字 (京都大学3, 広島大学1 etc.) ---
  name = name.replace(/(大学)\d+$/, "$1");

  // --- 4. 末尾の「N期」を除去 (つばめ会41期 → つばめ会, 名椙45期 → 名椙 etc.) ---
  name = name.replace(/\d+期$/, "");

  // --- 5. 末尾のスペース+数字を除去 (e.g. "金沢大学 3" → "金沢大学") ---
  name = name.replace(/\s+\d+$/, "");

  // --- 5b. 日本語名の末尾数字を除去 (e.g. "青葉会18" → "青葉会", "越王会'14" → "越王会") ---
  // 漢字・ひらがな・カタカナの後に続く '? + 数字 を除去（英字のみのクラブ名は対象外）
  name = name.replace(/([\u3000-\u9FFF\uF900-\uFAFF])'?\d+$/, "$1");

  // --- 6. 一般的な正規化 ---
  name = name.replace(/OLクラブ$/, "OLC");

  if (name === "ES関東" || name === "ES関東クラブ") {
    name = "ES関東C";
  }

  // --- 7. 略称→正式名の個別マッピング ---
  const aliasMap: Record<string, string> = {
    "三河": "三河OLC",
    "名椙": "名椙OLC",
    "大阪": "大阪OLC",
    "練馬": "練馬OLC",
    "レオ": "OLCレオ",
    "新潟": "新潟大学",
    "金沢": "金沢大学",
    "神戸": "神戸大学",
  };
  if (aliasMap[name]) name = aliasMap[name];

  return name;
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
import { execFileSync } from "child_process";
import * as cheerio from "cheerio";

const OPEN_CLASSES = [
  { typeId: 1, classId: 1, file: "age_forest_無差別.json" },
  { typeId: 1, classId: 20, file: "age_forest_女子無差別.json" },
  { typeId: 15, classId: 47, file: "age_sprint_S_無差別.json" },
  { typeId: 15, classId: 66, file: "age_sprint_S_女子無差別.json" },
];

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

function fetchFreshRankings() {
  const BASE = "https://japan-o-entry.com/ranking/ranking/ranking_index";

  for (const cls of OPEN_CLASSES) {
    try {
      // 全ページ取得（ページネーション対応）
      const allFresh: RawEntry[] = [];
      const seen = new Set<string>();
      for (let page = 0; ; page++) {
        const url = page === 0
          ? `${BASE}/${cls.typeId}/${cls.classId}`
          : `${BASE}/${cls.typeId}/${cls.classId}/${page}`;

        const html = execFileSync("curl", [
          "-s", "--max-time", "10",
          "-H", "User-Agent: trails.jp/1.0 (build sync)",
          url,
        ], { encoding: "utf-8", timeout: 15000 });

        const entries = parsePage(html);
        if (entries.length === 0) break;

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
        process.stdout.write(page === 0 ? `${added}` : `+${added}`);
      }

      // 既存データのイベントスコアをマージ（JOYは直近~1年分のみ）
      const filePath = path.join(RANKINGS_DIR, cls.file);
      let existing: RawEntry[] = [];
      try {
        existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch { /* first run */ }

      const existingScores = new Map<string, { event_name: string; points: number }[]>();
      for (const e of existing) {
        existingScores.set(e.athlete_name, e.event_scores || []);
      }
      for (const entry of allFresh) {
        const oldScores = existingScores.get(entry.athlete_name);
        if (oldScores && oldScores.length > 0) {
          const scoreMap = new Map<string, { event_name: string; points: number }>();
          for (const s of oldScores) scoreMap.set(s.event_name, s);
          for (const s of entry.event_scores) scoreMap.set(s.event_name, s);
          entry.event_scores = [...scoreMap.values()];
        }
      }

      fs.writeFileSync(filePath, JSON.stringify(allFresh, null, 2));
      console.log(` → ${cls.file}: ${allFresh.length} entries`);
    } catch (e) {
      console.warn(`  Failed ${cls.file}: using local file`);
    }
  }
}

console.log("Fetching fresh open-class rankings from JOY...");
try { fetchFreshRankings(); } catch (e) { console.warn("Ranking fetch failed, using local files:", e); }

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
    const key = entry.athlete_name;
    if (!athleteMap.has(key)) {
      athleteMap.set(key, { clubs: new Set(), appearances: [], allEvents: [] });
    }
    const data = athleteMap.get(key)!;

    if (entry.club && entry.club !== "-") {
      // "/"、全角スペース、"、" で区切られている場合、各クラブを個別に登録 + 名寄せ
      const clubNames = entry.club.split(/[\/\u3000、]/).map((c) => normalizeClubName(c)).filter(Boolean);
      for (const cn of clubNames) {
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

// recentForm を athletes に後付け
for (const [name, stats] of athleteStats) {
  if (athletes[name]) {
    athletes[name].recentForm = stats.recentForm;
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

// Write output
const athleteIndex = { athletes, generatedAt: new Date().toISOString() };
const clubIndex = { clubs, generatedAt: new Date().toISOString() };

const athleteJson = JSON.stringify(athleteIndex);
const clubJson = JSON.stringify(clubIndex);

fs.writeFileSync(path.join(OUTPUT_DIR, "athlete-index.json"), athleteJson);
fs.writeFileSync(path.join(OUTPUT_DIR, "club-stats.json"), clubJson);

console.log(`✓ athlete-index.json: ${athleteCount} athletes (${(athleteJson.length / 1024).toFixed(0)} KB)`);
console.log(`✓ club-stats.json: ${clubMap.size} clubs (${(clubJson.length / 1024).toFixed(0)} KB)`);
