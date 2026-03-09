import { NextResponse } from "next/server";

/**
 * @deprecated Phase 1 DB移行により廃止。/api/lc/[name] を使用してください。
 * 後方互換のため残置。Phase 2 完了後に削除予定。
 */
export async function GET() {
  return NextResponse.json(
    { error: "Deprecated. Use /api/lc/{name} instead." },
    { status: 410, headers: { "Cache-Control": "no-store" } }
  );
}
