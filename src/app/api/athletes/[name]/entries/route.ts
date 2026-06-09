import { NextResponse } from "next/server";
import { readEntryIndex } from "@/lib/entry-index-store";
import { normalizeNameKey } from "@/lib/name-key";

/**
 * GET /api/athletes/[name]/entries
 * 選手別エントリーインデックスから当該選手の出場予定大会を返す。
 * 照合キーは normalizeNameKey（NFKC正規化＋空白除去）。build-index と同一関数なので一致する。
 * 別名（旧姓⇄新姓等）は索引側で両キーに展開済みのため、ここは正規化のみでよい。
 * インデックスは日次 cron (sync-entries) が生成。未生成時は空配列。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const key = normalizeNameKey(decoded);

  if (!key) {
    return NextResponse.json({ name: decoded, entries: [], generatedAt: null });
  }

  try {
    const index = await readEntryIndex();
    const entries = index?.athletes[key] ?? [];
    return NextResponse.json(
      { name: decoded, entries, generatedAt: index?.generatedAt ?? null },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    console.error("Athlete entries fetch failed:", error);
    return NextResponse.json(
      { name: decoded, entries: [], generatedAt: null },
      { status: 200 },
    );
  }
}
