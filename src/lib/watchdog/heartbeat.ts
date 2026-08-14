/**
 * GitHub Actions cron-watchdog の heartbeat 鮮度判定。
 * watchdog 自身が無音で停止したとき、Vercel 側から検知するために使う。
 *
 * 純粋・依存なし・決定的（now を引数で受ける）に保つ。
 */

/**
 * 最新 ping 時刻から now までの経過時間（時間単位）。
 * パース不能（null/undefined/不正な日付）の場合は null。
 */
export function watchdogPingAgeHours(
  latestPingAt: string | null | undefined,
  now: number,
): number | null {
  if (!latestPingAt) return null;
  const t = new Date(latestPingAt).getTime();
  if (Number.isNaN(t)) return null;
  return (now - t) / 3_600_000;
}

/**
 * watchdog が「沈黙」しているか。
 * 最新 ping 時刻が null/不正、または経過時間が thresholdHours を超えていれば true。
 * （= 鮮度不明も「沈黙」扱いにして警告側に倒す。）
 */
export function isWatchdogSilent(
  latestPingAt: string | null | undefined,
  now: number,
  thresholdHours: number,
): boolean {
  const age = watchdogPingAgeHours(latestPingAt, now);
  if (age === null) return true;
  return age > thresholdHours;
}
