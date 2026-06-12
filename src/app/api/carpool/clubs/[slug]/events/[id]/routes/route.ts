import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { routeCreateSchema, routeUpdateSchema } from "@/lib/carpool/api/schemas";
import { toRouteDTO, type RouteTimeDTO } from "@/lib/carpool/api/mappers";
import {
  ERR,
  jsonError,
  zodError,
  guardWrite,
  writeChangeLog,
  resolveClub,
  assertOwnedByClub,
} from "@/lib/carpool/api/helpers";

export const dynamic = "force-dynamic";

/** POST /api/carpool/clubs/[slug]/events/[id]/routes — ルート作成（route_times 同梱）。 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  const { data: event, error: eventError } = await supabaseAdmin
    .from("carpool_events")
    .select("id")
    .eq("id", id)
    .eq("club_id", club.id)
    .maybeSingle();
  if (eventError) return ERR.serverError(eventError.message);
  if (!event) return ERR.notFound("大会");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ERR.invalidBody();
  }

  const parsed = routeCreateSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  // B1: イベントと routeTimes[].nodeId が当該クラブ所有かを検証。
  const denied = await assertOwnedByClub(club.id, {
    events: [id],
    nodes: (input.routeTimes ?? []).map((t) => t.nodeId),
  });
  if (denied) return denied;

  const insertRow: Record<string, unknown> = {
    club_id: club.id,
    event_id: id,
    name: input.name,
  };
  if (input.tollYen !== undefined) insertRow.toll_yen = input.tollYen;
  if (input.distanceKm !== undefined) insertRow.distance_km = input.distanceKm;
  if (input.riskScore !== undefined) insertRow.risk_score = input.riskScore;
  if (input.riskWindows !== undefined) insertRow.risk_windows = input.riskWindows;

  const { data: route, error } = await supabaseAdmin
    .from("carpool_routes")
    .insert(insertRow)
    .select("*")
    .single();
  if (error) return ERR.serverError(error.message);

  // M2: route 作成を即ログ（後続の times 保存が失敗しても route は監査に残す）。
  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_routes",
    recordId: route.id,
    action: "insert",
    payload: route,
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  let routeTimes: RouteTimeDTO[] = [];
  if (input.routeTimes && input.routeTimes.length > 0) {
    const timeRows = input.routeTimes.map((t) => ({
      club_id: club.id,
      route_id: route.id,
      node_id: t.nodeId,
      minutes_to_venue: t.minutesToVenue,
    }));
    const { error: timesError } = await supabaseAdmin
      .from("carpool_route_times")
      .insert(timeRows);
    // route は作成済み（ログ済み）。times だけ失敗時は 500。RPC 化は Phase 3 送り。
    if (timesError) {
      return jsonError("ルートは作成されましたが所要時間の保存に失敗しました", 500);
    }
    routeTimes = input.routeTimes.map((t) => ({ nodeId: t.nodeId, minutesToVenue: t.minutesToVenue }));
    await writeChangeLog({
      clubId: club.id,
      tableName: "carpool_route_times",
      recordId: route.id,
      action: "insert",
      payload: { routeId: route.id, routeTimes },
      actorName: guard.ctx.actorName,
      ipHash: guard.ctx.ipHash,
    });
  }

  return NextResponse.json({ route: toRouteDTO(route, routeTimes) }, { status: 201 });
}

/** PATCH /api/carpool/clubs/[slug]/events/[id]/routes — ルート更新（route_times 指定時は全置換）。 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ERR.invalidBody();
  }

  const parsed = routeUpdateSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const { data: existing, error: findError } = await supabaseAdmin
    .from("carpool_routes")
    .select("*")
    .eq("id", input.routeId)
    .eq("club_id", club.id)
    .eq("event_id", id)
    .maybeSingle();
  if (findError) return ERR.serverError(findError.message);
  if (!existing) return ERR.notFound("ルート");

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  // B1: イベント・ルート・routeTimes[].nodeId が当該クラブ所有かを検証。
  const denied = await assertOwnedByClub(club.id, {
    events: [id],
    routes: [input.routeId],
    nodes: (input.routeTimes ?? []).map((t) => t.nodeId),
  });
  if (denied) return denied;

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.tollYen !== undefined) patch.toll_yen = input.tollYen;
  if (input.distanceKm !== undefined) patch.distance_km = input.distanceKm;
  if (input.riskScore !== undefined) patch.risk_score = input.riskScore;
  if (input.riskWindows !== undefined) patch.risk_windows = input.riskWindows;

  let route = existing;
  if (Object.keys(patch).length > 0) {
    const { data, error } = await supabaseAdmin
      .from("carpool_routes")
      .update(patch)
      .eq("id", input.routeId)
      .eq("club_id", club.id)
      .eq("event_id", id)
      .select("*")
      .single();
    if (error) return ERR.serverError(error.message);
    route = data;
  }

  // M2: route 更新を即ログ（後続の times 置換が失敗しても route 変更は監査に残す）。
  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_routes",
    recordId: input.routeId,
    action: "update",
    payload: route,
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  let routeTimes: RouteTimeDTO[] | undefined;
  if (input.routeTimes !== undefined) {
    // 旧 times を before として先に取得（復元・changelog 用）。
    const { data: oldTimeRows, error: oldTimesError } = await supabaseAdmin
      .from("carpool_route_times")
      .select("*")
      .eq("route_id", input.routeId)
      .eq("club_id", club.id);
    if (oldTimesError) return ERR.serverError(oldTimesError.message);
    const before = (oldTimeRows ?? []).map((t) => ({
      nodeId: t.node_id,
      minutesToVenue: t.minutes_to_venue,
    }));

    const { error: delError } = await supabaseAdmin
      .from("carpool_route_times")
      .delete()
      .eq("route_id", input.routeId)
      .eq("club_id", club.id);
    if (delError) return ERR.serverError(delError.message);

    if (input.routeTimes.length > 0) {
      const timeRows = input.routeTimes.map((t) => ({
        club_id: club.id,
        route_id: input.routeId,
        node_id: t.nodeId,
        minutes_to_venue: t.minutesToVenue,
      }));
      const { error: insError } = await supabaseAdmin
        .from("carpool_route_times")
        .insert(timeRows);
      if (insError) {
        // 置換 insert 失敗 → 旧 times をベストエフォート再 insert で復元。RPC 化は Phase 3 送り。
        if ((oldTimeRows ?? []).length > 0) {
          await supabaseAdmin.from("carpool_route_times").insert(oldTimeRows as unknown[]);
        }
        return jsonError("所要時間の更新に失敗しました。再度お試しください", 500);
      }
    }
    routeTimes = input.routeTimes.map((t) => ({ nodeId: t.nodeId, minutesToVenue: t.minutesToVenue }));

    await writeChangeLog({
      clubId: club.id,
      tableName: "carpool_route_times",
      recordId: input.routeId,
      action: "update",
      payload: { before, after: routeTimes },
      actorName: guard.ctx.actorName,
      ipHash: guard.ctx.ipHash,
    });
  } else {
    const { data: times, error: timesError } = await supabaseAdmin
      .from("carpool_route_times")
      .select("*")
      .eq("route_id", input.routeId)
      .eq("club_id", club.id);
    if (timesError) return ERR.serverError(timesError.message);
    routeTimes = (times ?? []).map((t) => ({ nodeId: t.node_id, minutesToVenue: t.minutes_to_venue }));
  }

  return NextResponse.json({ route: toRouteDTO(route, routeTimes) });
}
