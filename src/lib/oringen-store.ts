import { supabaseAdmin } from "./supabase-admin";
import type { OringenData } from "./oringen/types";
import fallbackJson from "@/data/oringen-2026.json";

/**
 * O-Ringen 日本勢データの Storage 読み書き。`src/lib/events-store.ts` と同じ作法。
 *
 * ライブデータ（開催直前にスタート時刻が埋まり、開催中は結果が動く）なので、バンドル JSON ではなく
 * Supabase Storage に置く。バンドルはコミット時点で凍結するため（src/app/page.tsx:16 のコメント参照）。
 */

const BUCKET = "app-data";
const FILE_PATH = "oringen-2026.json";

// app-data バケットは既存（events.json / entry-index.json が常駐）。events-store.ts と同じ前提。
let bucketReady = true;

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
  bucketReady = true;
}

/**
 * 表示用の読み込み。取得できなければバンドルのスナップショットにフォールバックする
 * （ページは必ず何か出す。`generatedAt` を UI に出しているので、古ければ利用者が気づける）。
 */
export async function readOringen(): Promise<OringenData> {
  try {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(FILE_PATH);
    if (!error && data) {
      const text = await data.text();
      return JSON.parse(text) as OringenData;
    }
  } catch {
    // Supabase 未設定 or ファイル未作成 → フォールバック
  }
  return fallbackJson as OringenData;
}

/**
 * ingest 専用の厳格読み込み。読めなければ **null**（バンドルへフォールバックしない）。
 *
 * 劣化判定の「前回値」にバンドルの古いスナップショットを使うと、Storage 障害時に
 * 「前回=古いバンドル」との比較になって劣化を見逃す。比較対象が取れないなら初回扱いにする方が安全。
 */
export async function readOringenStrict(): Promise<OringenData | null> {
  try {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(FILE_PATH);
    if (!error && data) {
      const text = await data.text();
      return JSON.parse(text) as OringenData;
    }
  } catch {
    // Storage 障害・未設定 → null
  }
  return null;
}

export async function writeOringen(data: OringenData): Promise<void> {
  await ensureBucket();

  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(FILE_PATH, blob, { upsert: true, contentType: "application/json" });

  if (error) {
    if (/bucket not found/i.test(error.message)) {
      await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
      const { error: retryError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(FILE_PATH, blob, { upsert: true, contentType: "application/json" });
      if (!retryError) return;
      console.error("Failed to write oringen data after bucket create:", retryError.message);
      throw retryError;
    }
    console.error("Failed to write oringen data to Supabase Storage:", error.message);
    throw error;
  }
}
