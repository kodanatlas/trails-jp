/**
 * R2: クラブ名からの URL slug 自動生成（純粋ロジック）。
 *
 * slug 入力欄を廃止し、クラブ名から決定的に生成する。サーバの slug 制約
 * （/^[a-z0-9][a-z0-9-]*$/・2〜40文字）を常に満たす値を返す。
 *
 * 生成規則:
 *   1. NFKC 正規化（全角英数→半角）のうえ ASCII 英数字の連を抽出し、kebab 連結・小文字化。
 *   2. 結果が短い（3文字以下）場合は名前の決定的ハッシュ短縮形（base36 4文字）を付加。
 *      例: 「入間市OLC」→ "olc-xxxx"。OLC を含むクラブ名は多数あるため、短い slug は
 *      ハッシュで一意性を確保する（"olc" 単体は衝突必至）。
 *   3. ASCII が全く無い名前（例「トレイルズ」）は "club-xxxx" 形式。
 */

/** 決定的短縮ハッシュ（base36・4文字）。slug のサフィックスに使う。 */
export function hashSlugSuffix(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0; // uint32 に畳み込み
  }
  return h.toString(36).padStart(4, "0").slice(-4);
}

/** kebab ベース部の最大長（サフィックス込みで 40 文字以内に収めるため）。 */
const MAX_BASE = 32;

/** クラブ名 → slug（決定的・サーバ制約準拠）。 */
export function generateClubSlug(name: string): string {
  // ハッシュ種も NFKC 後の名前にする（全角/半角の表記違いで slug が変わらないように）。
  const normalized = (name ?? "").normalize("NFKC");
  const runs = normalized.match(/[A-Za-z0-9]+/g) ?? [];
  const base = runs.join("-").toLowerCase().slice(0, MAX_BASE).replace(/-+$/, "");
  if (base.length <= 3) {
    return base
      ? `${base}-${hashSlugSuffix(normalized)}`
      : `club-${hashSlugSuffix(normalized)}`;
  }
  return base;
}

/**
 * 409（slug 重複）時のリトライ用: 別サフィックスを付けた slug。
 * salt に現在時刻文字列などを渡すと毎回異なるサフィックスになる。
 */
export function retryClubSlug(slug: string, salt: string): string {
  return `${slug.slice(0, MAX_BASE)}-${hashSlugSuffix(salt)}`;
}
