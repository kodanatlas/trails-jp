import { readFileSync } from "fs";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import type { AthleteIndex } from "@/lib/analysis/types";

function loadAthleteIndex(): AthleteIndex["athletes"] {
  try {
    const index = JSON.parse(
      readFileSync(join(process.cwd(), "public/data/athlete-index.json"), "utf-8")
    ) as AthleteIndex;
    return index.athletes;
  } catch {
    return {};
  }
}

// 索引はモジュール初期化時に1回だけ読み、リクエスト間で再利用する。
const athleteIndex = loadAthleteIndex();

/**
 * GET /api/athletes/[name] — 1選手の詳細情報（appearances含む）
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  let key: string;
  try {
    key = decodeURIComponent(name).replace(/\s+/g, "");
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const athlete = athleteIndex[key];
  if (!athlete) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const summary = {
    name: athlete.name,
    clubs: athlete.clubs,
    bestRank: athlete.bestRank,
    avgTotalPoints: athlete.avgTotalPoints,
    forestCount: athlete.forestCount,
    sprintCount: athlete.sprintCount,
    type: athlete.type,
    recentForm: athlete.recentForm,
    appearances: athlete.appearances.map((appearance) => ({
      type: appearance.type,
      className: appearance.className,
      rank: appearance.rank,
      totalPoints: appearance.totalPoints,
      isActive: appearance.isActive,
    })),
  };

  return NextResponse.json(summary, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=86400" },
  });
}
