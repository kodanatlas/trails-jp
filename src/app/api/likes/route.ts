import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createHash } from "crypto";

const SALT = process.env.LIKE_SALT ?? "trails_jp";

function hashIp(ip: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${ip}${SALT}${day}`).digest("hex");
}

/** POST: いいね送信（単体 or 一括） */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId = body.sessionId;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ipHash = hashIp(ip);

    // 一括: athleteNames 配列
    const names: string[] = body.athleteNames ?? (body.athleteName ? [body.athleteName] : []);
    if (names.length === 0) {
      return NextResponse.json({ error: "Missing athlete name(s)" }, { status: 400 });
    }

    let inserted = 0;
    let duplicates = 0;
    const errors: string[] = [];
    for (const name of names.slice(0, 100)) {
      const { error } = await supabaseAdmin
        .from("likes")
        .insert({ athlete_name: name, session_id: sessionId, ip_hash: ipHash });
      if (!error) {
        inserted++;
      } else if (error.code === "23505") {
        duplicates++;
      } else {
        errors.push(error.message);
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: "Insert failed", inserted, errors }, { status: 500 });
    }

    if (names.length === 1 && duplicates === 1) {
      return NextResponse.json({ error: "Already liked" }, { status: 409 });
    }

    return NextResponse.json({ ok: true, inserted });
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
