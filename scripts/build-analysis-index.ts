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
  bestPoints: number;
  forestCount: number;
  sprintCount: number;
  type: "sprinter" | "forester" | "allrounder" | "unknown";
}

interface ClubMember {
  name: string;
  bestRank: number;
  bestPoints: number;
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
 * Forest / Sprint の最高ポイントを比較して特性を判定。
 * 15%以上の差があれば得意な方に分類、それ以下はオールラウンダー。
 */
function classifyType(
  appearances: { type: string; totalPoints: number }[]
): AthleteSummary["type"] {
  const forestApps = appearances.filter((r) => r.type.includes("forest"));
  const sprintApps = appearances.filter((r) => r.type.includes("sprint"));

  if (forestApps.length === 0 && sprintApps.length === 0) return "unknown";
  if (forestApps.length === 0) return "sprinter";
  if (sprintApps.length === 0) return "forester";

  const bestForestPts = Math.max(...forestApps.map((r) => r.totalPoints));
  const bestSprintPts = Math.max(...sprintApps.map((r) => r.totalPoints));

  const ratio = bestForestPts / bestSprintPts;
  if (ratio > 1.15) return "forester";
  if (ratio < 1 / 1.15) return "sprinter";
  return "allrounder";
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
 * - 大文字小文字統一 (OLC/olc → OLC)
 * - 末尾の数字除去 (金沢大学 3 → 金沢大学)
 * - OLクラブ → OLC
 * - ES関東クラブ / ES関東 → ES関東C
 */
function normalizeClubName(raw: string): string {
  let name = raw.trim();

  // 末尾のスペース+数字を除去 (e.g. "金沢大学 3" → "金沢大学")
  name = name.replace(/\s+\d+$/, "");

  // "OLクラブ" → "OLC"
  name = name.replace(/OLクラブ$/, "OLC");

  // "ES関東クラブ" / "ES関東" → "ES関東C"
  if (name === "ES関東" || name === "ES関東クラブ") {
    name = "ES関東C";
  }

  // 大文字小文字統一: olc → OLC
  name = name.replace(/olc$/i, "OLC");

  return name;
}

// --- Main ---
const RANKINGS_DIR = path.resolve(__dirname, "../public/data/rankings");
const OUTPUT_DIR = path.resolve(__dirname, "../public/data");

interface ParsedEvent {
  date: string;
  points: number;
}

const athleteMap = new Map<string, {
  clubs: Set<string>;
  appearances: RankingRef[];
  allEvents: ParsedEvent[]; // 全イベントスコア（重複排除前）
}>();

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
      // "/" で区切られている場合、各クラブを個別に登録 + 名寄せ
      const clubNames = entry.club.split("/").map((c) => normalizeClubName(c)).filter(Boolean);
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
    for (const es of entry.event_scores) {
      const { date } = parseEventName(es.event_name);
      if (date) {
        data.allEvents.push({ date, points: es.points });
      }
    }
  }
}

// 選手ごとのイベント重複排除 + 統計計算用ヘルパー
function dedupeEvents(events: ParsedEvent[]): ParsedEvent[] {
  const seen = new Set<string>();
  const result: ParsedEvent[] = [];
  for (const e of events) {
    const key = `${e.date}:${e.points}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(e);
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
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

function calcRecentForm(events: ParsedEvent[]): number {
  if (events.length < 2) return 0;
  const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date));
  const recent = sorted.slice(0, 3);
  const recentAvg = recent.reduce((s, e) => s + e.points, 0) / recent.length;
  const allAvg = sorted.reduce((s, e) => s + e.points, 0) / sorted.length;
  if (allAvg === 0) return 0;
  return Math.round(((recentAvg - allAvg) / allAvg) * 100);
}

// Build AthleteSummary records
const athletes: Record<string, AthleteSummary> = {};
let athleteCount = 0;

for (const [name, data] of athleteMap) {
  const forestCount = data.appearances.filter((r) => r.type.includes("forest")).length;
  const sprintCount = data.appearances.filter((r) => r.type.includes("sprint")).length;
  const bestRank = Math.min(...data.appearances.map((r) => r.rank));
  const bestPoints = Math.max(...data.appearances.map((r) => r.totalPoints));

  athletes[name] = {
    name,
    clubs: [...data.clubs],
    appearances: data.appearances,
    bestRank,
    bestPoints,
    forestCount,
    sprintCount,
    type: classifyType(data.appearances),
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
  athleteStats.set(name, {
    events,
    recentForm: calcRecentForm(events),
    consistency: calcConsistency(events),
  });
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
        bestPoints: profile.bestPoints,
        rankingType: bestApp.type,
        className: bestApp.className,
        athleteType: profile.type,
        isActive: profile.appearances.some((r) => r.isActive),
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
  const memberList = [...data.members.values()].sort((a, b) => a.bestRank - b.bestRank);
  const activeCount = memberList.filter((m) => m.isActive).length;
  const avgPoints =
    memberList.length > 0
      ? memberList.reduce((s, m) => s + m.bestPoints, 0) / memberList.length
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
