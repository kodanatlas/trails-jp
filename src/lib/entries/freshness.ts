/**
 * 選手別エントリー索引 (entry-index.json) の鮮度判定。
 * sync-entries cron が無音で停止すると索引が古くなり、最近の申込者が選手ページに出ない。
 *
 * 純粋・依存なし・決定的（now を引数で受ける）に保つ。cron ウォッチドッグから利用。
 */

/**
 * generatedAt(ISO) から now までの経過時間（時間単位）。
 * パース不能（null/undefined/不正な日付）の場合は null。
 */
export function entryIndexAgeHours(
  generatedAt: string | null | undefined,
  now: number,
): number | null {
  if (!generatedAt) return null;
  const t = new Date(generatedAt).getTime();
  if (Number.isNaN(t)) return null;
  return (now - t) / 3_600_000;
}

/**
 * 索引が「古い」か。
 * generatedAt が null/不正、または経過時間が thresholdHours を超えていれば true。
 * （= 鮮度不明も“古い”扱いにして警告側に倒す。）
 */
export function isEntryIndexStale(
  generatedAt: string | null | undefined,
  now: number,
  thresholdHours: number,
): boolean {
  const age = entryIndexAgeHours(generatedAt, now);
  if (age === null) return true;
  return age > thresholdHours;
}
