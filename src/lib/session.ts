const SESSION_KEY = "trails_session_id";
const LIKED_KEY = "trails_liked_athletes";

/** localStorage のセッションID（なければ生成） */
export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

/** いいね済み選手の Set を取得 */
export function getLikedAthletes(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(LIKED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

/** いいね済みリストに追加 */
export function addLikedAthlete(name: string): void {
  const set = getLikedAthletes();
  set.add(name);
  localStorage.setItem(LIKED_KEY, JSON.stringify([...set]));
}

/**
 * JST（月曜起点）の週の開始日を "YYYY-MM-DD" で返す。
 * サーバ側の一意制約 date_trunc('week', created_at AT TIME ZONE 'Asia/Tokyo')
 * と同じ境界（JST 月曜 00:00）で応援可否がリセットされるようにするためのバケット。
 */
function jstWeekStart(): string {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now); // "YYYY-MM-DD"（JST）
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", weekday: "short",
  }).format(now); // "Mon".."Sun"
  const offset: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (offset[wd] ?? 0));
  return d.toISOString().slice(0, 10);
}

/** グループ応援済みかチェック（JSTの週単位。週が変われば「未応援」に戻る） */
export function hasCheeredGroup(key: string): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(`trails_cheered_${key}`) === jstWeekStart();
}

/** グループ応援済みに設定（現在のJST週を記録。翌週には自動でリセットされる） */
export function setCheeredGroup(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(`trails_cheered_${key}`, jstWeekStart());
}
