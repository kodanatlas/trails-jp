import rankingsJson from "@/data/rankings.json";
import clubStatsJson from "../../public/data/club-stats.json";
import { readEvents } from "@/lib/events-store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface SiteStats {
  /** 収集イベント数（events ストア・ライブ） */
  events: number;
  /** ランキング掲載選手数（rankings.json のユニーク名） */
  athletes: number;
  /** 成績レコード数（lc_performances の DB 件数） */
  lcRecords: number;
  /** クラブ数（club-stats.json の clubs キー数） */
  clubs: number;
}

// Supabase 未設定 / 取得失敗時のフォールバック概数
const LC_RECORDS_FALLBACK = 18848;

/**
 * トップページ・技術ドキュメントで共有するサイト全体の規模数値。
 * events はライブ（Supabase Storage・日次 cron 更新。バンドル JSON はコミット時点で凍結するため使わない）、
 * athletes / clubs はビルド成果物（毎ビルド更新）、
 * lcRecords は DB 件数（ISR `revalidate` で更新）。
 * 両ページがこの関数を使うことで数値が常に一致する。
 * @param eventsCount 呼び出し側で readEvents() 済みの場合はその件数を渡す（二重取得回避）
 */
export async function getSiteStats(eventsCount?: number): Promise<SiteStats> {
  const events = eventsCount ?? (await readEvents()).length;

  const athletes = new Set(
    Object.values(rankingsJson as Record<string, { athlete_name: string }[]>)
      .flat()
      .map((e) => e.athlete_name)
  ).size;

  const clubs = Object.keys(
    (clubStatsJson as { clubs: Record<string, unknown> }).clubs
  ).length;

  let lcRecords = LC_RECORDS_FALLBACK;
  if (isSupabaseConfigured) {
    const { count, error } = await supabase
      .from("lc_performances")
      .select("*", { count: "exact", head: true });
    if (!error && typeof count === "number") lcRecords = count;
  }

  return { events, athletes, lcRecords, clubs };
}
