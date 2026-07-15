import type { OringenPerson } from "./types";

/**
 * 日本勢を trails.jp の選手ページ `/a/[key]` に結び付ける。純関数・決定的。
 *
 * **漢字が特定できている ≠ 選手ページがある。**
 * 漢字の照合に使ったのは Supabase の `athletes`（2,418名）だが、選手ページ `/a/[name]` が引くのは
 * `public/data/athlete-index.json`（1,684名・JOYランキング由来）で**別物**。後者に無い選手へ
 * リンクを張ると 404 になる（2026 実測: 漢字41名中 石井祐子・国沢五月・吉岡春樹 の3名がページ無し）。
 *
 * よって**索引に存在するときだけ**リンクする。存在確認はサーバー側でやること
 * （athlete-index.json は 1.9MB。クライアントバンドルに入れてはいけない）。
 *
 * キーの作り方は `src/app/a/[name]/page.tsx` の `resolveKey()` に合わせる（空白除去）。
 * ずれるとリンクが 404 になるのでテストで固定している。
 */

/** 漢字氏名 → athlete-index のキー。`/a/[name]/page.tsx` の resolveKey と同じ規則。 */
export function toAthleteKey(kanji: string): string {
  return kanji.replace(/\s+/g, "");
}

/**
 * 各人に `athleteKey` を付ける。索引に無ければ null（リンクしない）。
 *
 * @param athleteIndexKeys athlete-index.json の `athletes` のキー集合
 */
export function attachAthleteLinks(
  people: OringenPerson[],
  athleteIndexKeys: ReadonlySet<string>,
): OringenPerson[] {
  return people.map((p) => {
    if (!p.kanji) return { ...p, athleteKey: null };
    const key = toAthleteKey(p.kanji);
    return { ...p, athleteKey: athleteIndexKeys.has(key) ? key : null };
  });
}
