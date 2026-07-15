/**
 * sync-oringen の実行スケジュール。純関数・決定的。
 *
 * **`.github/workflows/sync-oringen.yml` の cron と必ず一致させること。**
 * yaml から TS を読めないため二重管理になっている。片方だけ変えるとページの「次回」表示が嘘になる。
 *   workflow: `- cron: "0 4,14 * * *"`  ←→  ここ: SYNC_HOURS_UTC = [4, 14]
 */

/** 実行する時刻（UTC の時）。04:00 UTC = 現地06:00（その日のスタート前）/ 14:00 UTC = 現地16:00（レース後）。 */
export const SYNC_HOURS_UTC = [4, 14];

/**
 * 次に同期が走る時刻を返す。
 *
 * **あくまで予定**。GitHub Actions の `schedule` は高負荷時に遅延・drop されうる（GitHub 公式）ため、
 * UI では「頃」と濁すこと。確約すると、止まったときに嘘をつくことになる。
 */
export function nextSyncAt(now: Date, hoursUtc: readonly number[] = SYNC_HOURS_UTC): Date {
  const sorted = [...hoursUtc].sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error("hoursUtc が空です");

  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  for (const h of sorted) {
    const cand = new Date(Date.UTC(y, m, d, h, 0, 0, 0));
    if (cand.getTime() > now.getTime()) return cand;
  }
  // 今日の分は終わっている → 翌日の最初
  return new Date(Date.UTC(y, m, d + 1, sorted[0]!, 0, 0, 0));
}
