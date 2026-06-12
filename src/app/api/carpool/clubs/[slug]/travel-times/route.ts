import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { travelTimesPutSchema } from "@/lib/carpool/api/schemas";
import { toTravelTimeDTO } from "@/lib/carpool/api/mappers";
import {
  ERR,
  zodError,
  guardWrite,
  writeChangeLog,
  resolveClub,
  assertOwnedByClub,
  dedupeTravelTimeEntries,
} from "@/lib/carpool/api/helpers";

export const dynamic = "force-dynamic";

/** GET /api/carpool/clubs/[slug]/travel-times — 移動時間一覧。 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  const { data, error } = await supabaseAdmin
    .from("carpool_travel_times")
    .select("*")
    .eq("club_id", club.id);
  if (error) return ERR.serverError(error.message);

  return NextResponse.json({ travelTimes: (data ?? []).map(toTravelTimeDTO) });
}

/** PUT /api/carpool/clubs/[slug]/travel-times — バッチ upsert（最大200件）。 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ERR.invalidBody();
  }

  const parsed = travelTimesPutSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  // B1: 参照ノードが当該クラブ所有かを書込み前に検証（他クラブ UUID 指定での乗っ取り防止）。
  const denied = await assertOwnedByClub(club.id, {
    nodes: input.entries.flatMap((e) => [e.fromNodeId, e.toNodeId]),
  });
  if (denied) return denied;

  // 同一 (from,to,mode) がバッチ内に重複すると upsert がエラーになるため後勝ち dedupe。
  const entries = dedupeTravelTimeEntries(input.entries);

  const now = new Date().toISOString();
  const rows = entries.map((e) => ({
    club_id: club.id,
    from_node_id: e.fromNodeId,
    to_node_id: e.toNodeId,
    mode: e.mode,
    minutes: e.minutes,
    source: e.source ?? "manual",
    updated_at: now,
  }));

  // M2: 上書き前の旧行を取得し changelog の before に残す（同一 (from,to,mode) キーのみ）。
  const keySet = new Set(entries.map((e) => `${e.fromNodeId}>${e.toNodeId}>${e.mode}`));
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("carpool_travel_times")
    .select("*")
    .eq("club_id", club.id);
  if (existingError) return ERR.serverError(existingError.message);
  const before = (existingRows ?? []).filter((r) =>
    keySet.has(`${r.from_node_id}>${r.to_node_id}>${r.mode}`),
  );

  const { data, error } = await supabaseAdmin
    .from("carpool_travel_times")
    .upsert(rows, { onConflict: "club_id,from_node_id,to_node_id,mode" })
    .select("*");
  if (error) return ERR.serverError(error.message);

  const upserted = data ?? [];

  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_travel_times",
    recordId: null,
    action: "update",
    payload: { before, after: upserted, count: upserted.length },
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  return NextResponse.json({
    travelTimes: upserted.map(toTravelTimeDTO),
    count: upserted.length,
  });
}
