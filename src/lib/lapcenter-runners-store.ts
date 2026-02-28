import { supabaseAdmin } from "./supabase-admin";

const BUCKET = "app-data";
const FILE_PATH = "lapcenter-runners.json";

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

/**
 * Supabase Storage から LC ランナーデータを読み込む。
 * 取得できない場合は空データを返す。
 */
export async function readLCRunners(): Promise<LCRunnersData> {
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .download(FILE_PATH);

    if (!error && data) {
      const text = await data.text();
      return JSON.parse(text) as LCRunnersData;
    }
  } catch {
    // Storage未設定 or ファイル未作成
  }

  return { athletes: {}, generatedAt: "" };
}

/**
 * LC ランナーデータを Supabase Storage に書き込む。
 */
export async function writeLCRunners(data: LCRunnersData): Promise<void> {
  // Ensure bucket exists
  await supabaseAdmin.storage.createBucket(BUCKET, { public: false }).catch(() => {});

  const blob = new Blob([JSON.stringify(data)], {
    type: "application/json",
  });

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(FILE_PATH, blob, {
      upsert: true,
      contentType: "application/json",
    });

  if (error) {
    console.error("Failed to write LC runners to Supabase Storage:", error.message);
    throw error;
  }
}
