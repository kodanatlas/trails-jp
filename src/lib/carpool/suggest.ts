/**
 * 正規候補サジェスト（指摘4）の純粋ロジック。
 *
 * trails.jp の名寄せは氏名・クラブとも正規形が固定化されている（氏名 = athletes テーブルの
 * 正規氏名 / クラブ = club-stats.json のキー）。ユーザーのゼロ入力は突合不整合の温床なので、
 * 入力中に正規データを候補表示して選ばせる。本ファイルは「候補→フォーム値への反映」と
 * 「候補の絞り込み」を純粋関数として切り出し、vitest で回帰テストする。UI・fetch は持たない。
 */

import { normalizeNameKey } from "@/lib/name-key";

// ---------------------------------------------------------------------------
// 氏名（athletes/search 候補）
// ---------------------------------------------------------------------------

/** 氏名候補を選んだときにフォームへ同時設定する値。 */
export interface AthleteSelectionFields {
  /** 表示名 = 正規氏名そのもの。 */
  displayName: string;
  /** 突合キー = normalizeNameKey(正規氏名)。 */
  athleteKey: string;
}

/** 候補（正規氏名）→ フォーム値。displayName と athleteKey を同時に決める。 */
export function athleteSelectionToFields(canonicalName: string): AthleteSelectionFields {
  const displayName = canonicalName.trim();
  return { displayName, athleteKey: normalizeNameKey(displayName) };
}

/**
 * 送信時の athleteKey 決定。
 *
 * - 候補未選択（自由入力）→ null（athleteKey を送らない）。サーバ側の自動付与
 *   （members POST の normalizeNameKey(displayName)）に委ねる。
 * - 候補選択後に displayName を編集しても、正準キーが同じ（空白・全半角差のみ）なら
 *   選択した正規氏名のキーを維持する。
 * - 別人に書き換えられた（正準キーが変わった）ら null に倒す（stale キーを送らない）。
 */
export function athleteKeyForSubmit(
  displayName: string,
  selectedCanonicalName: string | null,
): string | null {
  if (!selectedCanonicalName) return null;
  const selectedKey = normalizeNameKey(selectedCanonicalName);
  if (!selectedKey) return null;
  return normalizeNameKey(displayName) === selectedKey ? selectedKey : null;
}

/**
 * athletes/search を呼ぶべきクエリか（API 仕様の写し: ASCII のみは2文字以上、それ以外は1文字以上）。
 * debounce 前のゲートとして使い、無駄なリクエストを抑える。
 */
export function shouldQueryAthletes(query: string): boolean {
  const q = query.trim();
  if (q.length === 0) return false;
  const isAsciiOnly = /^[\x00-\x7F]+$/.test(q);
  return isAsciiOnly ? q.length >= 2 : true;
}

// ---------------------------------------------------------------------------
// クラブ（club-stats.json キー候補）
// ---------------------------------------------------------------------------

/** クラブ候補を選んだときにフォームへ同時設定する値。 */
export interface ClubSelectionFields {
  /** クラブ名 = 正規表記そのもの。 */
  name: string;
  /** JOY 表記名 = 正規表記1件。 */
  joeClubNames: string[];
}

/** 候補（正規クラブ名）→ フォーム値。name と joeClubNames（正規表記1件）を同時に決める。 */
export function clubSelectionToFields(canonicalClubName: string): ClubSelectionFields {
  const name = canonicalClubName.trim();
  return { name, joeClubNames: [name] };
}

/** 照合用の緩い正規化（NFKC + 小文字化 + 空白除去）。候補は正規形なので緩く照合すれば足りる。 */
function looseKey(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/**
 * クラブ名のインクリメンタル候補絞り込み。
 *
 * - NFKC + 小文字化 + 空白除去のうえ部分一致（"olc" でも "ＯＬＣ" でもヒット）。
 * - 前方一致を先に、その後にその他の部分一致（各グループは元配列順 = 安定）。
 * - クエリが空なら []（全件は出さない）。limit 件で打ち切り。
 */
export function filterClubCandidates(
  allClubNames: ReadonlyArray<string>,
  query: string,
  limit = 8,
): string[] {
  const q = looseKey(query);
  if (!q) return [];
  const starts: string[] = [];
  const includes: string[] = [];
  for (const name of allClubNames) {
    const key = looseKey(name);
    if (key.startsWith(q)) {
      starts.push(name);
      if (starts.length >= limit) break; // 前方一致だけで limit 充足
    } else if (key.includes(q)) {
      includes.push(name);
    }
  }
  return [...starts, ...includes].slice(0, limit);
}
