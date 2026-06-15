/**
 * 参加者一覧（③）の名前検索・並び替えの純粋ロジック。
 *
 * 調整さんモデル: 操作者概念なし。端末に「自分」を保存しない（毎回探す）ため、
 * 「自分の行が探さなくても見つかる」ことを並び替えと任意の名前検索で担保する。
 *   - 並び替え（未登録=JOY検出サブグループ）: クラブ一致→氏名順（ja ロケール）
 *     ※検出行はすべて JOY エントリー由来＝クラブ一致のため、実質は氏名順。
 *   - 検索: 入力即絞込（空白無視・ASCII は大文字小文字無視）。任意操作（ゲート外）。
 *     未登録（JOY検出）サブグループと登録済み行の両方を横断フィルタするため、
 *     UI 側は表示名さえ渡せば本モジュールで一様に判定できる。
 *
 * 旧「あなたはどれ？」カード（SelfPickCard）の検索・並び替えを③へ流用して残したもの。
 * カードの統合チップ構築（buildSelfPickChoices 等）は廃止済み。
 */

/** 検索・並び替えに必要な検出行の最小情報（DetectedEntry のサブセット）。 */
export interface DetectedNameInput {
  nameKey: string;
  rawName?: string | null;
}

/** 検出行の表示名（rawName > nameKey）。並び替え・検索の対象文字列。 */
export function detectedDisplayName(d: DetectedNameInput): string {
  return (d.rawName ?? "").trim() || d.nameKey;
}

/**
 * 検索用正規化: 全空白（全角含む）除去 + ASCII 小文字化。
 * 「山田 太郎」「山田太郎」どちらの表記でも当たるよう、両辺とも空白を無視して比較する。
 */
export function normalizeNameQuery(raw: string): string {
  return (raw ?? "").replace(/[\s　]+/g, "").toLowerCase();
}

/**
 * 表示名がクエリに（部分）一致するか。空クエリは常に true（絞り込まない）。
 * 未登録サブグループ・登録済み行の両方を横断フィルタするための一様判定。
 */
export function matchesNameQuery(name: string, query: string): boolean {
  const q = normalizeNameQuery(query);
  if (!q) return true;
  return normalizeNameQuery(name).includes(q);
}

/**
 * 未登録（JOY検出）サブグループの並び替え（②の並びを踏襲＝自分を見つけやすく）。
 * 検出行はすべてクラブ一致のため第一キーは効かないが、将来の混在に備えて
 * clubMatched 相当（検出由来=先）→ 氏名順（ja）で安定ソートする。
 * 元配列は変更せず新配列を返す。
 */
export function sortDetectedByName<T extends DetectedNameInput>(
  detected: ReadonlyArray<T>,
): T[] {
  return [...detected].sort((a, b) =>
    detectedDisplayName(a).localeCompare(detectedDisplayName(b), "ja"),
  );
}

/**
 * 名前検索の絞込（入力即時・部分一致）。空クエリは全件をそのまま返す。
 * 表示名は detectedDisplayName（rawName > nameKey）で評価する。
 */
export function filterDetectedByName<T extends DetectedNameInput>(
  detected: ReadonlyArray<T>,
  query: string,
): T[] {
  const q = normalizeNameQuery(query);
  if (!q) return [...detected];
  return detected.filter((d) => matchesNameQuery(detectedDisplayName(d), query));
}
