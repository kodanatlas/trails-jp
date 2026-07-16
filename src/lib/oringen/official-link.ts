import type { OringenPerson } from "./types";

/**
 * O-Ringen 公式結果システムの選手ページへのリンク先を決める。純関数・決定的。
 *
 * 公式の URL は「人」ではなく「エントリー」単位: `/{slug}/competitors/{entryId}`
 * （SPA のルート定義 `competitors/:entryId` を実測確認。2026-07-16）。よって:
 *
 * - 5日間クラス: 人×クラスで1つの ID を5日間共有 → 選手ページへ直接リンクできる（2026 は 39/50 名）
 * - Etappstart（1日単位エントリー）は日ごとに別 ID、複数クラス出場はクラスごとに別 ID
 *   → 1つに決められないので公式の氏名検索 `/{slug}/competitors?q={ローマ字氏名}` に送る。
 *   検索は `results/json?personName=` で全該当エントリーを列挙し、1件なら公式側が選手ページへ
 *   redirect する実装（バンドル実測）。氏名は "姓 名" のローマ字＝公式の登録名そのもの。
 */

/** エントリー ID → 公式選手ページの URL。resultUrl は OringenData.resultUrl（slug 込み）。 */
export function competitorPageUrl(resultUrl: string, competitorId: number): string {
  return `${resultUrl}/competitors/${competitorId}`;
}

/**
 * 人単位のリンク先。ID が1つなら選手ページへ直接、複数なら公式の氏名検索へ。
 * ID が1つも無い（competitorId 追加前の旧データ）なら null = リンクを出さない。
 */
export function officialCompetitorUrl(person: OringenPerson, resultUrl: string): string | null {
  const ids = new Set<number>();
  for (const entries of Object.values(person.entries)) {
    for (const e of entries) {
      if (typeof e.competitorId === "number") ids.add(e.competitorId);
    }
  }
  const [first] = ids;
  if (first === undefined) return null;
  if (ids.size === 1) return competitorPageUrl(resultUrl, first);
  return `${resultUrl}/competitors?q=${encodeURIComponent(person.name)}`;
}
