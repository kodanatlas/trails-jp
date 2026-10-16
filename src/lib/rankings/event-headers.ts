import * as cheerio from "cheerio";

// JOY ランキング表の大会列ヘッダ（例: "2026-10-12 トータス50周年Day3"）。
// 年齢別には大会でない列（"補完1" 等）が混じるため、日付で始まる列だけを大会列とみなす。
const EVENT_HEADER_RE = /^\d{4}-\d{2}-\d{2}(\s|$)/;

/** 改行・インデントを含む生ヘッダを1行に正規化する（build と cron で共用）。 */
export function normalizeHeader(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** 正規化・大会列のみ・重複排除・ソートした比較用の正準形。 */
export function canonicalEventHeaders(headers: readonly string[]): string[] {
  const events = headers.map(normalizeHeader).filter((h) => EVENT_HEADER_RE.test(h));
  return [...new Set(events)].sort();
}

/**
 * ランキングページ HTML から大会列ヘッダを抽出する。
 * ヘッダは全ページ共通（2026-10-16 実測）なので1ページ目だけで足りる。
 */
export function extractEventHeaders(html: string): string[] {
  const $ = cheerio.load(html);
  const raw = $("table thead th, table tr:first-child th")
    .toArray()
    .map((th) => $(th).text());
  return canonicalEventHeaders(raw);
}
