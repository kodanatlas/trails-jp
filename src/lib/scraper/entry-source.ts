/**
 * エントリーリスト取得のソース振り分け（JOY / どこオリ）。
 *
 * 下流（build-index・/api/events/[id]/entries・配車割の detect-entries ライブ取得）は
 * すべて整数 eventId を渡して `EntryListResult` を受け取るだけなので、ここで eventId の
 * レンジを見て JOY か どこオリ かを振り分ければ、各呼び出し側は1行差し替えで両対応できる。
 *
 * どこオリのイベントは合成ID（DOKORI_ID_BASE 以上）を持つため、ID だけで判別できる。
 */
import { scrapeEntryList, type EntryListResult } from "./entries";
import { scrapeDokoriEntryList, isDokoriEventId } from "./dokori";

/**
 * eventId のソースに応じて適切なスクレイパでエントリーリストを取得する。
 * オプション（signal / throwOnError）の意味は両ソースで同一。
 */
export function scrapeEntryListByEventId(
  eventId: number,
  opts: { signal?: AbortSignal; throwOnError?: boolean } = {},
): Promise<EntryListResult> {
  return isDokoriEventId(eventId)
    ? scrapeDokoriEntryList(eventId, opts)
    : scrapeEntryList(eventId, opts);
}
