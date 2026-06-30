/**
 * イベント名の近似一致ヘルパ (JOY↔LapCenter / 選手間の大会突合用)
 * AthleteDetail / CompareAthletes / HeadToHead で共用。
 */

import type { LapCenterPerformance } from "./types";

/** イベント名ノイズ除去 (年度・回数・括弧・記号等を落として正規化) */
export function stripEventNoise(s: string): string {
  let r = s;
  r = r.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  r = r.replace(/20\d{2}年度?/g, "");
  r = r.replace(/20\d{2}/g, "");
  r = r.replace(/第\s*[0-9一二三四五六七八九十百千]+\s*回/g, "");
  r = r.replace(/(令和|平成)\s*[0-9一-九十]+\s*年度?/g, "");
  r = r.replace(/[（(][^)）]*[)）]/g, "");
  r = r.replace(/【[^】]*】/g, "");
  for (const w of ["大会", "地区", "年度", "兼", "in", "IN", "の", "・", "　"]) r = r.replaceAll(w, "");
  r = r.replace(/[\s\-\/\\.,、。!！?？:：;；&＆'"_＿~～|｜\[\]［］{}]/g, "");
  return r.toLowerCase();
}

/** イベント名の近似一致判定 (正規化後の一致・包含・トライグラム類似) */
export function eventFuzzyMatch(a: string, b: string): boolean {
  const na = stripEventNoise(a);
  const nb = stripEventNoise(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length >= 3 && longer.includes(shorter)) return true;
  if (shorter.length >= 4 && longer.length >= 4) {
    const trigrams = new Set<string>();
    for (let i = 0; i <= shorter.length - 3; i++) trigrams.add(shorter.substring(i, i + 3));
    let common = 0;
    for (let i = 0; i <= longer.length - 3; i++) {
      if (trigrams.has(longer.substring(i, i + 3))) common++;
    }
    if (common / trigrams.size >= 0.6 && common >= 3) return true;
  }
  return false;
}

/**
 * 選手の大会参加リストで「ランキング行」を LapCenter(LC) レースに突合する。
 *
 * LC の race_type は大会名のキーワード推定（"スプリント" 等の有無）で決まるため、
 * 「前日大会」のようにスプリント実体でも語の無いレースを forest と誤判定しうる。一方 JOY
 * ランキングは同じレースを sprint カテゴリに入れる。この出典間の種目表記差で「同日×同種目」
 * 突合が外れ、同一レースがランキング行と LCのみ行の2行に重複表示されていた（例: 2026-06-13
 * 「東大大会前日」(rank=sprint) と「第48回東大OLK大会前日大会」(LC=forest)）。
 *
 * 突合方針:
 *  (1) 同日×同種目で一意化（従来挙動・最優先・ここは挙動を変えない）。
 *  (2) 同種目の LC レースが無い場合のフォールバック（種目表記の出典差を吸収）:
 *      - その日の LC レースが1種類 かつ ランキング側もその日1大会だけなら、種目差にすぎない
 *        同一レースとみなす（両出典が「その日1大会」と言えば取り違えはほぼ無い）。
 *      - もしくは大会名が近似一致すれば種目跨ぎでも拾う（名前アンカーで安全）。
 *
 * @param rankedEventsOnDate 同日のランキング行数（>=2 なら(2)の単一性フォールバックを抑止）
 */
export function matchLcRace(
  lcData: LapCenterPerformance[] | null | undefined,
  date: string,
  eventName: string,
  discipline: string,
  rankedEventsOnDate: number,
): LapCenterPerformance | null {
  const sameDate = (lcData ?? []).filter((p) => p.d === date);
  if (sameDate.length === 0) return null;

  // (1) 同日×同種目（従来挙動を厳密に維持）
  const sameDisc = sameDate.filter((p) => p.t === discipline);
  if (sameDisc.length > 0) {
    if (new Set(sameDisc.map((p) => p.e)).size === 1) return sameDisc[0];
    const byName = sameDisc.filter((p) => p.e === eventName);
    return byName.length === 1 ? byName[0] : null;
  }

  // (2) 種目跨ぎフォールバック（同種目の LC レースが無いときだけ働く＝(1)に非回帰）
  if (new Set(sameDate.map((p) => p.e)).size === 1 && rankedEventsOnDate <= 1) {
    return sameDate[0];
  }
  const fuzzy = sameDate.filter((p) => eventFuzzyMatch(p.e, eventName));
  return new Set(fuzzy.map((p) => p.e)).size === 1 ? fuzzy[0] : null;
}
