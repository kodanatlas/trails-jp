import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /api/athletes/search?q=xxx — 選手名・クラブ名で検索（上位20件）
 * 2,400人規模なので ILIKE で十分。
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();

  if (!q || q.length < 1) {
    return NextResponse.json({ error: "Missing q param" }, { status: 400 });
  }

  // ASCII のみの場合は2文字以上を要求
  const isAsciiOnly = /^[\x00-\x7F]+$/.test(q);
  if (isAsciiOnly && q.length < 2) {
    return NextResponse.json({ athletes: [] });
  }

  const pattern = `%${q}%`;

  // 名前またはクラブ配列内にマッチする選手を検索
  // clubs は TEXT[] なので array_to_string で検索
  const { data, error } = await supabaseAdmin
    .from("athletes")
    .select("name, clubs, best_rank, avg_total_points, forest_count, sprint_count, athlete_type, recent_form")
    .or(`name.ilike.${pattern},clubs.cs.{${q}}`)
    .order("best_rank", { ascending: true })
    .limit(20);

  if (error) {
    // clubs の cs (contains) が効かない場合のフォールバック: 名前のみ検索
    const { data: fallback, error: fbError } = await supabaseAdmin
      .from("athletes")
      .select("name, clubs, best_rank, avg_total_points, forest_count, sprint_count, athlete_type, recent_form")
      .ilike("name", pattern)
      .order("best_rank", { ascending: true })
      .limit(20);

    if (fbError) {
      return NextResponse.json({ error: fbError.message }, { status: 500 });
    }

    return NextResponse.json({ athletes: fallback ?? [] }, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
    });
  }

  return NextResponse.json({ athletes: data ?? [] }, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
  });
}
