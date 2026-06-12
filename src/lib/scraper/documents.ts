/**
 * JOY 大会ページの「発行書類」スクレイパ（配車割 Phase 4）。
 *
 * 大会ページ HTML から `/event/getfile/{id}` への発行書類リンク（要綱・スタートリスト等）を
 * 抽出する。純粋部分（parseDocuments）と fetch I/O（scrapeDocuments）を分離し、
 * events.ts と同じ fetch 作法（UA / revalidate）に揃える。
 */

import * as cheerio from "cheerio";

const BASE_URL = "https://japan-o-entry.com";

/** 発行書類 1 件（リンクテキスト + 絶対 URL）。 */
export interface JoeDocument {
  title: string;
  url: string;
}

/**
 * 大会ページ HTML から `/event/getfile/` を含むリンクを発行書類として抽出する純粋関数。
 *
 * - title = リンクテキストを trim（空なら url を代わりに使わず空のまま採用しない）。
 * - url = 絶対化（`http` 始まりはそのまま、相対なら BASE_URL を前置）。
 * - `/event/getfile/` を含む href のみ採用。
 * - 同一 url は先勝ちで除去（重複排除）。
 *
 * @param html 大会ページの HTML。
 * @returns 抽出した JoeDocument の配列（出現順・url 重複なし）。
 */
export function parseDocuments(html: string): JoeDocument[] {
  const $ = cheerio.load(html);
  const docs: JoeDocument[] = [];
  const seen = new Set<string>();

  $("a[href*='/event/getfile/']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href.includes("/event/getfile/")) return;

    const url = absolutize(href);
    if (seen.has(url)) return;

    const title = $(el).text().trim();
    if (!title) return; // テキストの無いリンクは UI で表示不能なので採らない

    seen.add(url);
    docs.push({ title, url });
  });

  return docs;
}

/** 相対 URL を BASE_URL 前置で絶対化。既に絶対（http/https）ならそのまま。 */
function absolutize(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`;
}

/**
 * JOY 大会ページを取得して発行書類リンクを抽出する。
 *
 * events.ts と同じ fetch 作法（UA / revalidate 3600）。取得失敗（!res.ok）や例外時は
 * 空配列を返す（グレースフル — 呼び出し側ルートが 200 で握れるように）。
 *
 * @param joeUrl 大会ページ URL（例: https://japan-o-entry.com/event/view/1234）。
 * @param opts.signal 中断シグナル（任意）。
 * @returns 発行書類の配列（失敗時は空配列）。
 */
export async function scrapeDocuments(
  joeUrl: string,
  opts?: { signal?: AbortSignal },
): Promise<JoeDocument[]> {
  try {
    const res = await fetch(joeUrl, {
      headers: { "User-Agent": "trails.jp/1.0 (carpool documents)" },
      next: { revalidate: 3600 },
      signal: opts?.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseDocuments(html);
  } catch {
    return [];
  }
}

export { BASE_URL as JOE_BASE_URL };
