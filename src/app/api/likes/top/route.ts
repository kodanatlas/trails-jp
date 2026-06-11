import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const CACHE_HEADERS = { "Cache-Control": "public, max-age=30, s-maxage=60" };

/** JST(UTC+9) の今週月曜 00:00 を UTC の ISO 文字列で返す */
function jstWeekStartIso(): string {
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  // 9時間ずらした Date に UTC getter を使うと JST の時計が読める
  const nowJst = new Date(Date.now() + JST_OFFSET_MS);
  const daysSinceMonday = (nowJst.getUTCDay() + 6) % 7; // 月曜=0, 日曜=6
  const mondayJstMs = Date.UTC(
    nowJst.getUTCFullYear(),
    nowJst.getUTCMonth(),
    nowJst.getUTCDate() - daysSinceMonday,
  );
  return new Date(mondayJstMs - JST_OFFSET_MS).toISOString();
}

/**
 * like_count desc 済みの配列を limit 位で切る。ただし limit 位と同数（タイ）の行は
 * 全て含める — 同率グループを途中で切ると表彰台の「+N人」が過少になるため。
 */
function cutAtTieBoundary<T extends { like_count: number }>(rows: T[], limit: number): T[] {
  if (rows.length <= limit) return rows;
  const cutoff = rows[limit - 1].like_count;
  return rows.filter((row, i) => i < limit || row.like_count >= cutoff);
}

/**
 * GET: いいね数上位の選手 (?limit=10)
 * - ?window=week: JST 月曜 00:00 起点の今週分を likes から集計
 * - window なし: 従来どおり累計ビュー（後方互換）
 * いずれも like_count desc → athlete_name asc の安定ソート。
 * limit 位タイの選手は limit を超えて全員返す（タイで切らない契約）。
 */
export async function GET(req: NextRequest) {
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get("limit") ?? "10", 10) || 10,
    50,
  );
  const window = req.nextUrl.searchParams.get("window");

  if (window === "week") {
    const { data, error } = await supabaseAdmin
      .from("likes")
      .select("athlete_name")
      .gte("created_at", jstWeekStartIso());

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 週内の行数は小さいので JS で集計
    const counts = new Map<string, number>();
    for (const row of (data ?? []) as { athlete_name: string }[]) {
      counts.set(row.athlete_name, (counts.get(row.athlete_name) ?? 0) + 1);
    }
    const sorted = [...counts.entries()]
      .map(([athlete_name, like_count]) => ({ athlete_name, like_count }))
      .sort(
        (a, b) =>
          b.like_count - a.like_count ||
          a.athlete_name.localeCompare(b.athlete_name, "ja"),
      );

    return NextResponse.json(cutAtTieBoundary(sorted, limit), { headers: CACHE_HEADERS });
  }

  // タイ境界判定のため limit より広めに取得してから JS で切る（distinct 選手数は小さい）
  const { data, error } = await supabaseAdmin
    .from("athlete_like_counts")
    .select("athlete_name, like_count")
    .order("like_count", { ascending: false })
    .order("athlete_name", { ascending: true })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(cutAtTieBoundary(data ?? [], limit), { headers: CACHE_HEADERS });
}
