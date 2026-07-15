/**
 * クラス名から難易度の色を取り出す。純関数・決定的。
 *
 * O-Ringen の開放クラス／Etappstart は `Blå 3,5` `Etappstart Gul 2,5` `Svart 7,5` のように
 * **スウェーデン語の色名＋コース長(km)** で構成される。色が難易度そのものを表す
 * （Grön=初心者 … Svart=難）。日本の読み手には色名が読めないので、UI で色見本を添える。
 */

export interface DifficultyLevel {
  sv: string;
  ja: string;
  hex: string;
  level: string;
  desc: string;
}

/**
 * クラス名に含まれる難易度の色を返す。無ければ null（年齢クラス H40 等）。
 *
 * 長い名前から先にマッチさせる必要はない（色名同士は前方一致しない）が、
 * 単語境界は見る。`Blått`（架空）のような別語に誤マッチしないように。
 */
export function difficultyOf(className: string, levels: readonly DifficultyLevel[]): DifficultyLevel | null {
  const n = className.trim();
  for (const d of levels) {
    // 色名は単独の語として現れる（`Etappstart Gul 2,5` / `Gul 10,0` / `Blå 3,5`）
    const re = new RegExp(`(^|\\s)${d.sv}(\\s|$)`, "u");
    if (re.test(n)) return d;
  }
  return null;
}
