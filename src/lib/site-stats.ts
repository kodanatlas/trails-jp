import eventsJson from "@/data/events.json";
import rankingsJson from "@/data/rankings.json";
import clubStatsJson from "../../public/data/club-stats.json";
import type { JOEEvent } from "@/lib/scraper/events";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface SiteStats {
  /** 収集イベント数（events.json） */
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
 * events / athletes / clubs はビルド成果物（毎ビルド更新）、
 * lcRecords は DB 件数（ISR `revalidate` で日次更新）。
 * 両ページがこの関数を使うことで数値が常に一致する。
 */
export async function getSiteStats(): Promise<SiteStats> {
  const events = (eventsJson as JOEEvent[]).length;

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
