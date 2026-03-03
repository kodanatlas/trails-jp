import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createHash } from "crypto";

const SALT = process.env.LIKE_SALT ?? "trails_jp";

function hashIp(ip: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${ip}${SALT}${day}`).digest("hex");
}

/** POST: いいね送信 */
export async function POST(req: NextRequest) {
  try {
    const { athleteName, sessionId } = await req.json();
    if (!athleteName || !sessionId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ipHash = hashIp(ip);

    const { error } = await supabaseAdmin
      .from("likes")
      .insert({ athlete_name: athleteName, session_id: sessionId, ip_hash: ipHash });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "Already liked" }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

/** GET: 指定選手のいいね数取得 (?athletes=A,B,C) */
export async function GET(req: NextRequest) {
  const athletes = req.nextUrl.searchParams.get("athletes");
  if (!athletes) {
    return NextResponse.json({ error: "Missing athletes param" }, { status: 400 });
  }

  const names = athletes.split(",").map((n) => n.trim()).filter(Boolean).slice(0, 100);

  const { data, error } = await supabaseAdmin
    .from("athlete_like_counts")
    .select("athlete_name, like_count")
    .in("athlete_name", names);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.athlete_name] = row.like_count;
  }

  return NextResponse.json(counts, {
    headers: { "Cache-Control": "public, max-age=30, s-maxage=60" },
  });
}
