/**
 * イベント名の近似一致ヘルパ (JOY↔LapCenter / 選手間の大会突合用)
 * AthleteDetail / CompareAthletes / HeadToHead で共用。
 */

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
