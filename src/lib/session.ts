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
