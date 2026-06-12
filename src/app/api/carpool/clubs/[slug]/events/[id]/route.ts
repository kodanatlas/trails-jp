import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { eventUpdateSchema } from "@/lib/carpool/api/schemas";
import {
  toEventDTO,
  toRouteDTO,
  toRouteTimeDTO,
  toParticipationDTO,
  type RouteTimeDTO,
} from "@/lib/carpool/api/mappers";
import {
  ERR,
  zodError,
  guardWrite,
  writeChangeLog,
  resolveClub,
  assertOwnedByClub,
} from "@/lib/carpool/api/helpers";

export const dynamic = "force-dynamic";

/** GET /api/carpool/clubs/[slug]/events/[id] — 大会詳細（ルート・参加状況同梱）。 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  const { data: event, error: eventError } = await supabaseAdmin
    .from("carpool_events")
    .select("*")
    .eq("id", id)
    .eq("club_id", club.id)
    .maybeSingle();
  if (eventError) return ERR.serverError(eventError.message);
  if (!event) return ERR.notFound("大会");

  const { data: routes, error: routesError } = await supabaseAdmin
    .from("carpool_routes")
    .select("*")
    .eq("event_id", id)
    .eq("club_id", club.id);
  if (routesError) return ERR.serverError(routesError.message);

  const { data: routeTimes, error: timesError } = await supabaseAdmin
    .from("carpool_route_times")
    .select("*")
    .eq("club_id", club.id);
  if (timesError) return ERR.serverError(timesError.message);

  const timesByRoute = new Map<string, RouteTimeDTO[]>();
  for (const t of routeTimes ?? []) {
    const list = timesByRoute.get(t.route_id) ?? [];
    list.push(toRouteTimeDTO(t));
    timesByRoute.set(t.route_id, list);
  }

  const { data: participations, error: partError } = await supabaseAdmin
    .from("carpool_participations")
    .select("*")
    .eq("event_id", id)
    .eq("club_id", club.id);
  if (partError) return ERR.serverError(partError.message);

  return NextResponse.json({
    event: toEventDTO(event),
    routes: (routes ?? []).map((r) => toRouteDTO(r, timesByRoute.get(r.id) ?? [])),
    participations: (participations ?? []).map(toParticipationDTO),
  });
}

/** PATCH /api/carpool/clubs/[slug]/events/[id] — 大会更新。 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  const { data: existing, error: findError } = await supabaseAdmin
    .from("carpool_events")
    .select("*")
    .eq("id", id)
    .eq("club_id", club.id)
    .maybeSingle();
  if (findError) return ERR.serverError(findError.message);
  if (!existing) return ERR.notFound("大会");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ERR.invalidBody();
  }

  const parsed = eventUpdateSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  // B1: venueNodeId が当該クラブ所有かを検証（イベント自体の club 一致は上で確認済み）。
  const denied = await assertOwnedByClub(club.id, { nodes: [input.venueNodeId] });
  if (denied) return denied;

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.eventDate !== undefined) patch.event_date = input.eventDate;
  if (input.status !== undefined) patch.status = input.status;
  if (input.bufferMin !== undefined) patch.buffer_min = input.bufferMin;
  if (input.venueNodeId !== undefined) patch.venue_node_id = input.venueNodeId;
  if (input.bulletinUrl !== undefined) patch.bulletin_url = input.bulletinUrl;
  if (input.startlistUrl !== undefined) patch.startlist_url = input.startlistUrl;

  const { data, error } = await supabaseAdmin
    .from("carpool_events")
    .update(patch)
    .eq("id", id)
    .eq("club_id", club.id)
    .select("*")
    .single();
  if (error) return ERR.serverError(error.message);

  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_events",
    recordId: id,
    action: "update",
    payload: data,
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  return NextResponse.json({ event: toEventDTO(data) });
}
