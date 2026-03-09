import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /api/athletes/[name] — 1選手の詳細情報（appearances含む）
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  // 選手基本情報
  const { data: athlete, error: aErr } = await supabaseAdmin
    .from("athletes")
    .select("*")
    .eq("name", decoded)
    .single();

  if (aErr || !athlete) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // appearances
  const { data: appearances } = await supabaseAdmin
    .from("athlete_appearances")
    .select("ranking_type, class_name, rank, total_points, is_active")
    .eq("athlete_id", athlete.id);

  const summary = {
    name: athlete.name,
    clubs: athlete.clubs,
    bestRank: athlete.best_rank,
    avgTotalPoints: Number(athlete.avg_total_points),
    forestCount: athlete.forest_count,
    sprintCount: athlete.sprint_count,
    type: athlete.athlete_type,
    recentForm: Number(athlete.recent_form),
    appearances: (appearances ?? []).map((a) => ({
      type: a.ranking_type,
      className: a.class_name,
      rank: a.rank,
      totalPoints: Number(a.total_points),
      isActive: a.is_active,
    })),
  };

  return NextResponse.json(summary, {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" },
  });
}
