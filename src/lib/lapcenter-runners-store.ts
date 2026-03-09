/**
 * @deprecated Phase 1 DB移行により廃止。
 * LC データは lc_performances テーブルに移行済み。
 * - 読み取り: /api/lc/[name] (src/app/api/lc/[name]/route.ts)
 * - 書き込み: sync-lapcenter Cron が supabaseAdmin.from("lc_performances").upsert()
 * Phase 2 完了後にこのファイルを削除。
 */

export interface LCPerformance {
  d: string;  // date
  e: string;  // event name
  c: string;  // class name
  s: number;  // cruising speed
  m: number;  // miss rate
  t: "forest" | "sprint";
}

export interface LCRunnersData {
  athletes: Record<string, LCPerformance[]>;
  generatedAt: string;
}
