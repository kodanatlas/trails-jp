import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildLegH2H, type LegH2HRow } from "@/lib/analysis/leg-h2h";

/**
 * GET /api/h2h-legs?a=<選手名>&b=<選手名>
 * 2選手が同一クラス（＝同一コース）を走ったレースの、レッグ単位の勝敗を返す。
 * lc_leg_splits の区間タイム(lap_sec)を比較。外部(mulka2)取得は不要。
 */
export async function GET(req: NextRequest) {
  const a = req.nextUrl.searchParams.get("a");
  const b = req.nextUrl.searchParams.get("b");
  if (!a || !b) {
    return NextResponse.json({ error: "a と b が必要です" }, { status: 400 });
  }
  const keyA = a.replace(/\s+/g, "");
  const keyB = b.replace(/\s+/g, "");
  if (keyA === keyB) {
    return NextResponse.json({ races: [], wonA: 0, wonB: 0, tied: 0, legs: 0 });
  }

  const { data, error } = await supabaseAdmin
    .from("lc_leg_splits")
    .select("lc_event_id, lc_class_id, event_date, event_name, class_name, race_type, runner_key, lap_sec")
    .in("runner_key", [keyA, keyB]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = buildLegH2H((data ?? []) as LegH2HRow[], keyA, keyB);
  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=86400" },
  });
}
