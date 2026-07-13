import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

interface LcPerfRow {
  event_date: string;
  event_name: string;
  class_name: string;
  cruising_speed: number | string;
  miss_rate: number | string;
  race_type: string;
  rank: number | null;
}

/**
 * GET /api/lc/[name] — 1選手のLCパフォーマンス全履歴を返す
 * DB から直接クエリ。レスポンスは数KB。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  // 出走順位(rank)は lc_leg_splits を DB 側で LEFT JOIN する RPC で1クエリ取得する。
  // 2クエリに分けると1リクエストあたりのDB負荷が倍化し、脆弱なインスタンスを飽和させた
  // ため（2026-07-08 regression）、元の単一クエリと同じ負荷プロファイルに揃える。
  const { data, error } = await supabaseAdmin.rpc("get_lc_perf_with_rank", { p_name: decoded });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // クライアントが期待する形式に変換（既存の LapCenterPerformance 型 + 任意の順位 r）
  const performances = (data as LcPerfRow[]).map((r) => ({
    d: r.event_date,
    e: r.event_name,
    c: r.class_name,
    s: Number(r.cruising_speed),
    m: Number(r.miss_rate),
    t: r.race_type as "forest" | "sprint",
    r: r.rank ?? null,
  }));

  return NextResponse.json(performances, {
    // ブラウザは毎回CDNに確認(max-age=0)し旧版を抱えない。CDNは10分fresh＋以降は
    // stale配信しつつ裏で再検証。日次のper-leg取込・デプロイが最大10分で反映される。
    // stale-if-error: オリジン(DB)が5xx/不達でも直近の良い応答を24h配信し、DB一時障害で
    // カード/レッグリンクが消えるのを防ぐ(2026-07-12 DBオリジン不達事故の緩和)。
    headers: { "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=172800" },
  });
}
