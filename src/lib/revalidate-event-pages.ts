import { revalidatePath } from "next/cache";

/**
 * events ストアを読むページ（/・/events・/results）を作り直させる。events ストアを書いた cron の直後に呼ぶ。
 *
 * 2026-11-05: 時間ベース ISR（10分）で /events（HTML＋RSC＋セグメントで約 60 ISR write unit/回）を
 * 1 日 140 回作り直しており、Hobby の ISR Writes 無料枠（200,000/月）の約 8 割を食っていた。
 * データが変わるのは cron の時だけなので、書いた時だけ作り直し、時間ベースは 1 日の保険に延ばした。
 * 失敗しても同期本体は成功扱い（保険の 1 日 ISR で追いつく）。
 */
export function revalidateEventPages(): { revalidated: string[]; error?: string } {
  const paths = ["/", "/events", "/results"];
  try {
    for (const p of paths) revalidatePath(p);
    return { revalidated: paths };
  } catch (err) {
    console.error("revalidateEventPages failed:", err);
    return { revalidated: [], error: String(err) };
  }
}
