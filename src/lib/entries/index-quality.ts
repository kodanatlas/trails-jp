import type { EntryIndex } from "./index-types";

/**
 * 選手別エントリー索引の「劣化上書き」検知。
 *
 * sync-entries は冪等な再生成で、毎回 entry-index.json を**上書き**する（全滅時のみ既存保持）。
 * Vercel cron と外部バックストップが競合したり、JOY/どこオリの一時遮断で部分失敗すると、
 * 「成功扱いだが athletes が激減した index」で良い index を潰す（last-writer-wins）危険がある。
 *
 * そこで「既存が十分大きい」ときに限り、新 index の athletes 数が既存の minRatio 未満なら
 * 「劣化」とみなして呼び出し側が上書きを拒否できるようにする（純粋関数・決定的）。
 */
export function isIndexRegression(
  prev: EntryIndex | null,
  next: EntryIndex,
  opts: { minRatio: number; floor: number },
): boolean {
  if (!prev) return false; // 既存が無ければ初回生成。常に書いてよい。
  const prevCount = Object.keys(prev.athletes ?? {}).length;
  const nextCount = Object.keys(next.athletes ?? {}).length;
  if (prevCount < opts.floor) return false; // 既存が小さい（成長期・閑散期）なら判定しない
  return nextCount < prevCount * opts.minRatio; // 大幅減 = 劣化
}
