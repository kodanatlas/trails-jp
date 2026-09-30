import { unstable_cache } from "next/cache";
import { fetchEventClasses } from "@/lib/scraper/lapcenter";

/**
 * 大会内のクラス一覧（mulka2）のデータキャッシュ。結果の再掲載でクラスID が振り直されることがあるため
 * 1 時間で更新する（旧: 「不変」前提の 1 日。src/lib/results/class-id-drift.ts）。
 */
export const getEventClassesCached = unstable_cache(
  (eventId: number) => fetchEventClasses(eventId),
  ["lc-event-classes"],
  { revalidate: 3600 }
);
