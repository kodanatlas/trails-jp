import { supabaseAdmin } from "./supabase-admin";
import type { EntryIndex } from "./entries/index-types";

const BUCKET = "app-data";
const FILE_PATH = "entry-index.json";

// app-data バケットは既存（events.json / entry-index.json が常駐）。cold start ごとに createBucket を
// 叩くと write のクリティカルパスに Storage 往復が増え 60s 予算を圧迫するため、既存前提で true 起点にする。
let bucketReady = true;

/** バケットが無ければ作成（初回のみ。既存ならエラーは無視）。events-store と同一バケット。 */
async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
  bucketReady = true;
}

/**
 * 選手別エントリーインデックスを Supabase Storage から読み込む。
 * 未設定 or 未生成（cron 未実行）の場合は null を返す（呼び出し側は空表示にフォールバック）。
 */
export async function readEntryIndex(): Promise<EntryIndex | null> {
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .download(FILE_PATH);

    if (!error && data) {
      const text = await data.text();
      return JSON.parse(text) as EntryIndex;
    }
  } catch {
    // Supabase未設定 or ファイル未作成 → null
  }
  return null;
}

/**
 * 選手別エントリーインデックスを Supabase Storage に書き込む。
 */
export async function writeEntryIndex(index: EntryIndex): Promise<void> {
  await ensureBucket();

  const blob = new Blob([JSON.stringify(index)], {
    type: "application/json",
  });

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(FILE_PATH, blob, {
      upsert: true,
      contentType: "application/json",
    });

  if (error) {
    // 新規環境でバケット未作成のときだけ作成して1回だけ再試行（通常は既存＝この経路に来ない＝write は単一op）。
    if (/bucket not found/i.test(error.message)) {
      await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
      const { error: retryError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(FILE_PATH, blob, { upsert: true, contentType: "application/json" });
      if (!retryError) return;
      console.error("Failed to write entry-index after bucket create:", retryError.message);
      throw retryError;
    }
    console.error("Failed to write entry-index to Supabase Storage:", error.message);
    throw error;
  }
}
