/**
 * 直近の土日祝クラスタを選ぶための純関数群（上「ポイント上昇度」ビルド経路と
 * 下「合成上昇度」ランタイム RPC 経路の両方で共有）。
 *
 * 重要: 曜日判定は TZ 非依存にするため `Date.UTC(...).getUTCDay()` を用いる
 *      （ローカルタイムゾーンに依存させない）。「今日」だけは JST 基準で求める。
 */
import holidaysJson from "@/data/jp-holidays.json";

const HOLIDAYS = new Set<string>(holidaysJson.dates);

/** "YYYY-MM-DD" を [y, m, d]（m は 1-12）に分解 */
function parseYmd(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.split("-").map((v) => parseInt(v, 10));
  return [y, m, d];
}

/** "YYYY-MM-DD" から曜日（0=日 .. 6=土）。TZ 非依存（UTC ベース）。 */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = parseYmd(dateStr);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 土(6)/日(0) または国民の祝日に該当するか。 */
export function isWeekendOrHoliday(dateStr: string): boolean {
  const wd = weekdayOf(dateStr);
  return wd === 0 || wd === 6 || HOLIDAYS.has(dateStr);
}

/** Asia/Tokyo の今日を "YYYY-MM-DD" で返す（sv-SE ロケール = ISO 形式）。 */
export function jstToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** Asia/Tokyo の現在時刻を "YYYY-MM-DD HH:mm" で返す。 */
export function jstNowLabel(): string {
  // sv-SE + minute 指定で "YYYY-MM-DD HH:mm"（秒なし）が得られる。
  return new Date().toLocaleString("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** UTC ベースで日数を加減算（"YYYY-MM-DD" → "YYYY-MM-DD"）。DST/TZ 非依存。 */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = parseYmd(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * [today - windowDays, today] の各日のうち、土日祝に該当する日付を昇順で返す。
 * 候補日として RPC / ポイント集計に渡す。
 */
export function recentWeekendCandidates(today: string, windowDays = 28): string[] {
  const out: string[] = [];
  for (let i = windowDays; i >= 0; i--) {
    const day = addDays(today, -i);
    if (isWeekendOrHoliday(day)) out.push(day);
  }
  return out;
}

/**
 * 「データの存在する日付集合」のうち最大日 dmax と、その 2 日前まで（> dmax-3 日）に入る
 * 日付（= 土日/連休ブロック）を昇順で返す。空なら []。
 * 例: ["2026-05-30","2026-06-13","2026-06-14"] → ["2026-06-13","2026-06-14"]
 */
export function selectLatestCluster(presentDates: string[]): string[] {
  if (presentDates.length === 0) return [];
  const sorted = [...presentDates].sort((a, b) => a.localeCompare(b));
  const dmax = sorted[sorted.length - 1];
  const lowerBound = addDays(dmax, -2); // dmax を含む 3 日窓（dmax, -1d, -2d）
  return sorted.filter((d) => d >= lowerBound && d <= dmax);
}

/**
 * 日付配列を日本語の範囲表記に整形。
 * 単日 → "6/14"、同月連続 → "6/13–14"、跨ぎ月 → "6/30–7/1"。区切りは en dash。
 */
export function formatDateRangeJp(dates: string[]): string {
  if (dates.length === 0) return "";
  const sorted = [...dates].sort((a, b) => a.localeCompare(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const [, fm, fd] = parseYmd(first);
  const [, lm, ld] = parseYmd(last);
  if (first === last) return `${fm}/${fd}`;
  if (fm === lm) return `${fm}/${fd}–${ld}`; // 同月: 月は1回だけ
  return `${fm}/${fd}–${lm}/${ld}`; // 跨ぎ月
}
