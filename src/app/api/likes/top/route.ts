import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** GET: いいね数上位の選手 (?limit=10) */
export async function GET(req: NextRequest) {
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get("limit") ?? "10", 10) || 10,
    50,
  );

  const { data, error } = await supabaseAdmin
    .from("athlete_like_counts")
    .select("athlete_name, like_count")
    .order("like_count", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? [], {
    headers: { "Cache-Control": "public, max-age=30, s-maxage=60" },
  });
}
