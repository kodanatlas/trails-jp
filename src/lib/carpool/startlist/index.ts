/**
 * スタートリスト解析ライブラリ（配車割 Phase 4）の公開エントリポイント。
 *
 * 純粋ロジック（parse / match）と PDF 読込 I/O を分離し、ここは unpdf を呼ぶだけの
 * 薄いラッパに留める。純粋部分は vitest でテストする。
 */

import { extractText, getDocumentProxy } from "unpdf";
import { parseStartlistText, type StartlistRow } from "@/lib/carpool/startlist/parse";

export type { StartlistRow } from "@/lib/carpool/startlist/parse";
export { parseStartlistText } from "@/lib/carpool/startlist/parse";
export {
  matchStartlistRows,
  type StartlistMatch,
  type ExistingMemberRef,
} from "@/lib/carpool/startlist/match";
export {
  buildApplyTargets,
  type ApplyTarget,
  type ApplySkipped,
  type ImportOverride,
} from "@/lib/carpool/startlist/apply-plan";
export { isAllowedStartlistUrl } from "@/lib/carpool/startlist/url-allow";

/**
 * スタートリスト PDF（バイト列）を解析して StartlistRow[] を返す。
 *
 * unpdf で `getDocumentProxy` → `extractText(pdf, { mergePages: false })` し、
 * ページ別 plain text を parseStartlistText に渡すだけ（純粋部分はテスト済）。
 *
 * @param data PDF のバイト列。
 * @returns 抽出した StartlistRow の配列。
 */
export async function extractStartlistFromPdf(data: Uint8Array): Promise<StartlistRow[]> {
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  return parseStartlistText(text);
}
