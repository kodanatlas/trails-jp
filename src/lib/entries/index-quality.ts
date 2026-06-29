import type { EntryIndex } from "./index-types";

/**
 * 選手別エントリー索引の「劣化上書き」検知。
 *
 * sync-entries は冪等な再生成で、毎回 entry-index.json を**上書き**する（全滅時のみ既存保持）。
 * Vercel cron と外部バックストップが競合したり、JOY/どこオリの一時遮断で部分失敗すると、
 * 「成功扱いだが athletes が激減した index」で良い index を潰す（last-writer-wins）危険がある。
 *
 * ただし athletes 総数は**カレンダーで自然に増減する**: 大型大会の週末が過ぎると、その出場者
 * （他に開催前エントリーが無い人）が「開催前」窓から正しく抜け、総数は大きく減る。旧実装は
 * この**正常な減少**を劣化と誤検知してブロックしていた（例: 2026-06-28 のロングセレ2大会=計922名が
 * 過ぎた翌日に 1396→784 へ落ち、誤発火）。
 *
 * そこで「総数の前回比」をやめ、誤検知しない2系統で劣化だけを弾く:
 *
 *  (A) カバレッジ崩壊: 今回 run の `scrapedEventCount / targetEventCount` が低い
 *      = 予算切れ/JOYの遮断(403/timeout=throwでscraped未計上)で**対象大会の多くを取り切れなかった**。
 *      窓外へ出た大会は targetEventCount にも入らないため、カレンダー変動では下がらない（誤発火しない）。
 *  (B) 同一大会の取りこぼし: prev と next の両方でフェッチ成功した大会(scrapedEventIds)の**共通集合**で
 *      エントリー数を比較。窓外へ出た大会は next の scrape 集合に無い→共通から外れ正常減少は中和。
 *      同一大会が 200-空(ソフトブロック)で 0 件化した分だけが比に効く→真の劣化を捕まえる。
 *      ロゲイニング/講習等（氏名一覧が無く常に 0 件）は prev/next 双方 0 → 比に中立（特別扱い不要）。
 *
 * scrapedEventIds を持たない旧 index・共通大会が薄い場合は、従来の athletes 総数比較にフォールバックする
 * （カバレッジ健全なら誤発火しないよう、総数比較は最後の保険）。純粋関数・決定的（外部依存なし）。
 */

export interface RegressionOpts {
  /** 同一大会のエントリー総数（フォールバック時は athletes 総数）が既存比でこの比未満なら劣化。 */
  minRatio: number;
  /** 比較の母数（共通大会のエントリー総数 / フォールバックは既存 athletes 数）がこの値未満なら判定しない。 */
  floor: number;
  /** per-event 比較に必要な「prev∩next の共通スクレイプ大会数」の下限。未満ならフォールバック。既定 8。 */
  minCommonEvents?: number;
  /** カバレッジ崩壊の閾値: scraped/target がこの比未満なら劣化。既定 0.7。 */
  minCoverageRatio?: number;
  /** カバレッジ判定を適用する最小 targetEventCount（閑散期の誤発火回避）。既定 10。 */
  minTargetsForCoverage?: number;
}

export type RegressionMode =
  | "coverage-collapse" // 対象大会の多くを取り切れなかった（予算切れ/遮断）
  | "per-event" // 共通大会のエントリー数で判定（本筋）
  | "fallback-count" // 旧来の athletes 総数比較
  | "skip-no-prev" // 既存なし＝初回生成
  | "skip-floor"; // 母数が floor 未満＝判定しない

export interface RegressionAssessment {
  regression: boolean;
  mode: RegressionMode;
  /** per-event: prev∩next の共通大会数 / それ以外: -1 */
  commonEvents: number;
  /** 比較に使った既存側の母数（per-event=共通大会のエントリー総数, fallback=athletes 数, coverage=targetEventCount） */
  prevBasis: number;
  /** 比較に使った新側の母数（coverage=scrapedEventCount） */
  nextBasis: number;
}

/** index 内の「大会ID → そこに紐づくエントリー参照数（=その大会の索引化人数）」を数える。 */
function entriesPerEvent(index: EntryIndex): Map<number, number> {
  const m = new Map<number, number>();
  for (const refs of Object.values(index.athletes ?? {})) {
    if (!Array.isArray(refs)) continue; // 破損 blob 対策（malformed value で throw させない）
    for (const ref of refs) {
      if (!ref || typeof ref.joe_event_id !== "number") continue;
      m.set(ref.joe_event_id, (m.get(ref.joe_event_id) ?? 0) + 1);
    }
  }
  return m;
}

/**
 * 劣化判定の詳細を返す（ログ/通知で mode・母数を可視化するため）。
 * isIndexRegression はこの regression フラグの薄いラッパ。
 */
export function assessRegression(
  prev: EntryIndex | null,
  next: EntryIndex,
  opts: RegressionOpts,
): RegressionAssessment {
  if (!prev) {
    // 既存が無ければ初回生成。常に書いてよい。
    return { regression: false, mode: "skip-no-prev", commonEvents: -1, prevBasis: 0, nextBasis: 0 };
  }

  const minCommonEvents = opts.minCommonEvents ?? 8;
  const minCoverageRatio = opts.minCoverageRatio ?? 0.7;
  const minTargetsForCoverage = opts.minTargetsForCoverage ?? 10;

  // ---- (A) カバレッジ崩壊（カレンダー非依存・next のみで判定。部分スクレイプ/遮断を捕まえる）----
  // 対象が十分あるのに取得成功が大幅に欠ける = 良い index を貧弱な index で潰す危険。
  if (
    next.targetEventCount >= minTargetsForCoverage &&
    next.scrapedEventCount < next.targetEventCount * minCoverageRatio
  ) {
    return {
      regression: true,
      mode: "coverage-collapse",
      commonEvents: -1,
      prevBasis: next.targetEventCount,
      nextBasis: next.scrapedEventCount,
    };
  }

  // ---- (B) same-event 比較（窓ずれ=正常減少を中和し、同一大会の取りこぼし=劣化だけを捕まえる）----
  const prevIds = prev.scrapedEventIds;
  const nextIds = next.scrapedEventIds;
  if (prevIds && prevIds.length > 0 && nextIds && nextIds.length > 0) {
    const nextScraped = new Set(nextIds);
    const prevPer = entriesPerEvent(prev);
    const nextPer = entriesPerEvent(next);

    let commonEvents = 0;
    let prevSum = 0;
    let nextSum = 0;
    for (const id of new Set(prevIds)) {
      if (!nextScraped.has(id)) continue; // 新スクレイプ対象に無い大会(窓外)= 正常減少 → 除外
      commonEvents++;
      prevSum += prevPer.get(id) ?? 0;
      nextSum += nextPer.get(id) ?? 0;
    }

    if (commonEvents >= minCommonEvents) {
      if (prevSum < opts.floor) {
        return { regression: false, mode: "skip-floor", commonEvents, prevBasis: prevSum, nextBasis: nextSum };
      }
      return {
        regression: nextSum < prevSum * opts.minRatio,
        mode: "per-event",
        commonEvents,
        prevBasis: prevSum,
        nextBasis: nextSum,
      };
    }
    // 共通大会が薄い（窓が大きくずれた等）→ フォールバックへ
  }

  // ---- (C) フォールバック: 旧来の athletes 総数比較（scrapedEventIds が無い旧 index・共通大会が薄い場合）----
  // (A) でカバレッジ健全を確認済みなので、ここに来る正常な run を誤ブロックしにくい（移行直後の1回など）。
  const prevCount = Object.keys(prev.athletes ?? {}).length;
  const nextCount = Object.keys(next.athletes ?? {}).length;
  if (prevCount < opts.floor) {
    return { regression: false, mode: "skip-floor", commonEvents: -1, prevBasis: prevCount, nextBasis: nextCount };
  }
  return {
    regression: nextCount < prevCount * opts.minRatio,
    mode: "fallback-count",
    commonEvents: -1,
    prevBasis: prevCount,
    nextBasis: nextCount,
  };
}

/** 新 index が既存に対して「劣化上書き」かを返す（呼び出し側が上書きを拒否するための真偽値）。 */
export function isIndexRegression(
  prev: EntryIndex | null,
  next: EntryIndex,
  opts: RegressionOpts,
): boolean {
  return assessRegression(prev, next, opts).regression;
}
