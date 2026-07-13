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
    // 索引が読めない(Storage一時障害/不達)＝「エントリー無し」ではない。空を200で成功キャッシュすると
    // 一時障害中に「今後のエントリー」が最大1h消える(2026-07-13 レビュー指摘)。→ 503 を返して
    // クライアントにリトライさせ、CDN の stale-if-error で直近の良い応答を配信させる。
    if (!index) {
      return NextResponse.json(
        { name: decoded, entries: [], generatedAt: null, error: "index_unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const entries = index.athletes[key] ?? [];
    return NextResponse.json(
      { name: decoded, entries, generatedAt: index.generatedAt ?? null },
      {
        headers: {
          // stale-if-error: 後続で索引不達(503)になっても直近の良い応答を24h配信する。
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=86400",
        },
      },
    );
  } catch (error) {
    console.error("Athlete entries fetch failed:", error);
    return NextResponse.json(
      { name: decoded, entries: [], generatedAt: null, error: "fetch_failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
