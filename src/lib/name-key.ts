/**
 * 氏名の正準キー（全システム共通の照合キー）。
 *
 * 照合は「選手マスタの氏名」と「JOYエントリーの氏名」の突き合わせで行う。両者を同じ関数で
 * 正規化することで、全角/半角・互換文字・空白差を吸収する。
 *
 * - NFKC 正規化: 全角英数⇄半角・半角カナ⇄全角カナ・CJK互換文字などの表記差を統一。
 * - 空白除去: 「姓 名」と「姓名」を同一視（従来からの仕様）。
 *
 * 注意: 旧字体⇄新字体（例 「斎/齋/斉」）は別コードポイントで NFKC でも統一されない。
 *       実在する別表記・旧姓/新姓は下の ALIAS_PAIRS（別名マップ）で対応する。
 */
export function normalizeNameKey(name: string): string {
  return (name ?? "").normalize("NFKC").replace(/\s+/g, "");
}

/**
 * 同一人物とみなす氏名ペア（旧姓⇄新姓・通名・表記揺れなど）。raw 氏名で記述してよい（内部で正規化）。
 * 索引構築時に、エントリー氏名がどちらの表記でも、両方のキーで索引化される（双方向）。
 *
 * 実際の不一致（選手ページにエントリーが出ない＝氏名がマスタと違う）を見つけたら、ここに1行追記する。
 *   例: ["山田花子", "佐藤花子"],  // 結婚で姓が変わった等
 */
const ALIAS_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // ["旧姓フルネーム", "新姓フルネーム"],
];

/** 正規化キー -> 同一視する別キー集合（自分自身は含まない）。ALIAS_PAIRS から対称に構築。 */
const aliasMap: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const set = m.get(a) ?? new Set<string>();
    set.add(b);
    m.set(a, set);
  };
  for (const [a, b] of ALIAS_PAIRS) {
    const ka = normalizeNameKey(a);
    const kb = normalizeNameKey(b);
    if (!ka || !kb || ka === kb) continue;
    link(ka, kb);
    link(kb, ka);
  }
  return m;
})();

/**
 * 索引時に使う「このキーと同一視すべきキー一覧」（自分自身を先頭に含む・重複なし）。
 * 別名が無ければ [key] のみを返す（＝正規化のみが効く）。
 */
export function expandAliasKeys(key: string): string[] {
  const extra = aliasMap.get(key);
  if (!extra || extra.size === 0) return [key];
  return [key, ...extra];
}
