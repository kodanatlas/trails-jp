/**
 * O-Ringen のクラブ名 → 日本語名。純関数・決定的。
 *
 * O-Ringen 側はローマ字しか持たない（`Irumashi OLC`）ので、日本の読み手向けに `入間市OLC` を併記する。
 * 対応表 `src/data/oringen-club-map.json` は**照合済み選手の trails.jp 側の実所属から割り出した**もので、
 * 推測ではない。
 *
 * **すべてのクラブに日本語名があるわけではない。** `Siosio Japan` `OK22` は O-Ringen 用の臨時チームで、
 * メンバーの実所属はバラバラ（Siosio Japan の9名は 京都OLC・OLP兵庫・朱雀OK 等の関西勢混成）。
 * 実在しない日本語名を捏造せず、「臨時チーム」と示す。
 */

export interface ClubInfo {
  ja?: string | null;
  adhoc?: boolean;
  note?: string;
}

export interface ClubDisplay {
  /** 日本語名。無ければ null */
  ja: string | null;
  /** O-Ringen 用の臨時チームか */
  adhoc: boolean;
  /** 臨時チームの補足（メンバーの実所属など） */
  note: string | null;
}

/**
 * クラブの表示情報を返す。未知のクラブは「日本語名なし・臨時でもない」として扱う
 * （対応表に無い＝分からないだけ。臨時と決めつけない）。
 */
export function clubDisplay(club: string, map: Record<string, ClubInfo>): ClubDisplay {
  const info = map[club];
  return {
    ja: info?.ja ?? null,
    adhoc: info?.adhoc === true,
    note: info?.note ?? null,
  };
}
