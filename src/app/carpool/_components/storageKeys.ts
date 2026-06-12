/**
 * 配車 UI が使う localStorage キーの正本（直書き重複の防止）。
 *
 * - クラブ記憶: `carpool.club`（最後に選択したクラブ slug）
 * - 操作者名:   `carpool.actor.<slug>`（クラブ slug ごと）
 */

/** 最後に選択したクラブ slug を記憶するキー。 */
export const CLUB_STORAGE_KEY = "carpool.club";

/** クラブ slug ごとの操作者名キー。 */
export function actorStorageKey(slug: string): string {
  return `carpool.actor.${slug}`;
}

/** クラブ slug を localStorage に記憶する（不可環境では無視）。 */
export function rememberClub(slug: string): void {
  try {
    window.localStorage.setItem(CLUB_STORAGE_KEY, slug);
  } catch {
    /* noop */
  }
}

/** 記憶済みクラブ slug を読む（SSR・不可環境では null）。 */
export function readRememberedClub(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(CLUB_STORAGE_KEY);
    return stored && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}
