import { NextRequest, NextResponse } from "next/server";
import { fetchSplitListDetailed } from "@/lib/scraper/lapcenter";

/**
 * GET /api/lc-split/[eventId]/[classId]
 * mulka2 LapCenter split-list.jsp を on-demand 取得し、全ランナーの per-leg 詳細を返す。
 * relay-first（再計算なし）。エッジキャッシュで mulka2 への負荷と初回以降のレイテンシを抑える。
 */

// undici(カスタム dispatcher) を使うため Node ランタイム必須（Edge 不可）。
export const runtime = "nodejs";
// mulka2 取得＋パースの余裕（大クラスでも収まる程度）。
export const maxDuration = 30;

// 一過性の失敗を CDN が長期キャッシュしないためのヘッダ（レビュー F）
const NO_STORE = { "Cache-Control": "public, max-age=0, must-revalidate" };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventId: string; classId: string }> },
) {
  const { eventId, classId } = await params;
  const e = parseInt(eventId, 10);
  const c = parseInt(classId, 10);
  if (Number.isNaN(e) || Number.isNaN(c) || e < 0 || c < 0) {
    return NextResponse.json({ error: "invalid params" }, { status: 400, headers: NO_STORE });
  }

  try {
    const runners = await fetchSplitListDetailed(e, c);
    if (runners.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json(
      { eventId: e, classId: c, runners },
      {
        headers: {
          // CDN で 1h キャッシュ、以降 1 日は stale を返しつつ裏で更新
          "Cache-Control": "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (err) {
    console.error("lc-split fetch failed:", err);
    return NextResponse.json({ error: "upstream fetch failed" }, { status: 502, headers: NO_STORE });
  }
}
