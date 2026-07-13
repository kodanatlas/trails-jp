import { supabaseAdmin } from "./supabase-admin";
import type { JOEEvent } from "./scraper/events";
import eventsJson from "@/data/events.json";

const BUCKET = "app-data";
const FILE_PATH = "events.json";

// app-data バケットは既存（events.json / entry-index.json が常駐）。cold start ごとに createBucket を
// 叩くと write のクリティカルパスに Storage 往復が増えるため、既存前提で true 起点にする。
let bucketReady = true;

/** バケットが無ければ作成（初回のみ） */
async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
  bucketReady = true;
}

/**
 * Supabase Storage からイベントデータを読み込む。
 * 取得できない場合は静的 JSON にフォールバック。
 */
export async function readEvents(): Promise<JOEEvent[]> {
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .download(FILE_PATH);

    if (!error && data) {
      const text = await data.text();
      return JSON.parse(text) as JOEEvent[];
    }
  } catch {
    // Supabase未設定 or ファイル未作成 → フォールバック
  }

  return eventsJson as JOEEvent[];
}

/**
 * sync 系 cron 専用の厳格読み込み。Supabase Storage から読めなければ **null** を返す
 * （静的バンドル `data/events.json` へはフォールバックしない）。
 *
 * 通常の `readEvents()` は表示用にバンドルへフォールバックするが、cron でそれをやると
 * 「古い・どこオリ無しのバンドル events」で entry-index を作り直し、良い index を潰す危険がある。
 * cron は fail-closed（読めなければ再生成しない）にしたいので、本関数を使う。
 */
export async function readEventsStrict(): Promise<JOEEvent[] | null> {
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .download(FILE_PATH);

    if (!error && data) {
      const text = await data.text();
      return JSON.parse(text) as JOEEvent[];
    }
  } catch {
    // Storage 障害・未設定 → null（呼び出し側で再生成をスキップ）
  }
  return null;
}

/**
 * イベントデータの最終同期時刻（sync-events cron の最新成功時刻）を返す。
 * cron_log テーブルから取得。取得できなければ null。
 */
export async function getEventsLastSync(): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from("cron_log")
      .select("created_at")
      .eq("job_name", "sync-events")
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { created_at?: string } | null)?.created_at ?? null;
  } catch {
    return null;
  }
}

/**
 * イベントデータを Supabase Storage に書き込む。
 */
export async function writeEvents(events: JOEEvent[]): Promise<void> {
  await ensureBucket();

  const blob = new Blob([JSON.stringify(events)], {
    type: "application/json",
  });

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(FILE_PATH, blob, {
      upsert: true,
      contentType: "application/json",
    });

  if (error) {
    console.error("Failed to write events to Supabase Storage:", error.message);
    throw error;
  }
}
