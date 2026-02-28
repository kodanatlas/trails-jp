import { NextResponse } from "next/server";
import { readLCRunners } from "@/lib/lapcenter-runners-store";

/**
 * LC ランナーデータ API
 * Supabase Storage から取得。未設定時は 404（フロントは静的 JSON にフォールバック）。
 */
export async function GET() {
  const data = await readLCRunners();
  if (!data.generatedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
  });
}
