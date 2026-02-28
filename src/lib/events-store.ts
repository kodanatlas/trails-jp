import { supabaseAdmin } from "./supabase-admin";
import type { JOEEvent } from "./scraper/events";
import eventsJson from "@/data/events.json";

const BUCKET = "app-data";
const FILE_PATH = "events.json";

let bucketReady = false;

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
