import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

  const { data, error } = await supabaseAdmin
    .from("lc_performances")
    .select("event_date, event_name, class_name, cruising_speed, miss_rate, race_type")
    .eq("athlete_name", decoded)
    .order("event_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // クライアントが期待する形式に変換（既存の LapCenterPerformance 型）
  const performances = data.map((r) => ({
    d: r.event_date,
    e: r.event_name,
    c: r.class_name,
    s: Number(r.cruising_speed),
    m: Number(r.miss_rate),
    t: r.race_type as "forest" | "sprint",
  }));

  return NextResponse.json(performances, {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" },
  });
}
