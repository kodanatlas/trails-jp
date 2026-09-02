import { readFileSync } from "fs";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import type { AthleteIndex, AthleteSummary } from "@/lib/analysis/types";

interface AthleteSearchResult {
  name: string;
  clubs: string[];
  best_rank: number;
  avg_total_points: number;
  forest_count: number;
  sprint_count: number;
  athlete_type: AthleteSummary["type"];
  recent_form: number;
}

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60, s-maxage=60",
};

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

// 1.8MB の索引はモジュール初期化時に1回だけ読み、リクエスト間で再利用する。
const athleteIndex = loadAthleteIndex();

const normalizeName = (name: string) => name.replace(/\s+/g, "").toLowerCase();

/** 索引から氏名・所属の一致候補を順位順に返す純粋な検索処理。 */
function searchAthletes(
  index: AthleteIndex["athletes"],
  q: string,
  limit: number
): AthleteSearchResult[] {
  const query = q.trim();
  if (!query || (/^[\x00-\x7F]+$/.test(query) && query.length < 2)) return [];

  const normalizedNameQuery = normalizeName(query);
  const clubQuery = query.toLowerCase();

  return Object.entries(index)
    .filter(([key, athlete]) =>
      normalizeName(key).includes(normalizedNameQuery) ||
      normalizeName(athlete.name).includes(normalizedNameQuery) ||
      athlete.clubs.some((club) => club.toLowerCase().includes(clubQuery))
    )
    .sort(([, a], [, b]) => a.bestRank - b.bestRank)
    .slice(0, limit)
    .map(([, athlete]) => ({
      name: athlete.name,
      clubs: athlete.clubs,
      best_rank: athlete.bestRank,
      avg_total_points: athlete.avgTotalPoints,
      forest_count: athlete.forestCount,
      sprint_count: athlete.sprintCount,
      athlete_type: athlete.type,
      recent_form: athlete.recentForm,
    }));
}

/**
 * GET /api/athletes/search?q=xxx — 選手名・クラブ名で検索（上位20件）
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json({ error: "Missing q param" }, { status: 400 });
  }

  return NextResponse.json(
    { athletes: searchAthletes(athleteIndex, q, 20) },
    { headers: CACHE_HEADERS }
  );
}
