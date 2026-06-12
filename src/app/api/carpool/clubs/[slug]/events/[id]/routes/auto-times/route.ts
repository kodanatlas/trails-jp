import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { routeTimesAutoSchema } from "@/lib/carpool/api/schemas";
import { ERR, zodError, guardWrite, writeChangeLog, resolveClub } from "@/lib/carpool/api/helpers";
import { fetchOsrmTable, buildRouteTimesToVenue, type GeoNode } from "@/lib/carpool/osrm";

export const dynamic = "force-dynamic";

/**
 * D2: POST /api/carpool/clubs/[slug]/events/[id]/routes/auto-times
 * 大会の全ルートの route_times を OSRM の「各ノード → 会場ノード」car 所要で自動投入する。
 *
 * - 会場ノードに座標が必要（venue_node_id が null / 座標なしなら案内を返す）。
 * - 既存の route_times（手入力）は上書きしない。未登録の (route_id, node_id) のみ insert。
 * - OSRM 不達時は count:0 + 日本語案内。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  const { data: event, error: eventError } = await supabaseAdmin
    .from("carpool_events")
    .select("id, venue_node_id")
    .eq("id", id)
    .eq("club_id", club.id)
    .maybeSingle();
  if (eventError) return ERR.serverError(eventError.message);
  if (!event) return ERR.notFound("大会");

  if (event.venue_node_id == null) {
    return NextResponse.json({
      count: 0,
      message: "会場の場所が未設定です。会場を設定し座標を取得してください",
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ERR.invalidBody();
  }

  const parsed = routeTimesAutoSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  // 1) 座標つきノードを GeoNode 化。会場ノードがこの集合に含まれている必要がある。
  const { data: nodeRows, error: nodesError } = await supabaseAdmin
    .from("carpool_nodes")
    .select("id, lat, lng")
    .eq("club_id", club.id);
  if (nodesError) return ERR.serverError(nodesError.message);

  const geoNodes: GeoNode[] = (nodeRows ?? [])
    .filter((n) => n.lat != null && n.lng != null)
    .map((n) => ({ id: n.id, lat: Number(n.lat), lng: Number(n.lng) }));

  const venueIndex = geoNodes.findIndex((n) => n.id === event.venue_node_id);
  if (venueIndex < 0) {
    return NextResponse.json({
      count: 0,
      message: "会場の場所の座標がありません。マスタで取得してください",
    });
  }

  // 2) OSRM を 1 回叩き、各ノード → 会場 の car 所要を組み立てる。
  const durations = await fetchOsrmTable(geoNodes);
  const venueTimes = buildRouteTimesToVenue(geoNodes, venueIndex, durations);
  const timesByNode = new Map(venueTimes.map((t) => [t.nodeId, t.minutesToVenue]));

  // 3) 大会の全ルートを取得し、各ルートで未登録の (route_id, node_id) のみ insert。
  const { data: routes, error: routesError } = await supabaseAdmin
    .from("carpool_routes")
    .select("id")
    .eq("event_id", id)
    .eq("club_id", club.id);
  if (routesError) return ERR.serverError(routesError.message);

  let totalInserted = 0;
  for (const route of routes ?? []) {
    // 既存 route_times の node_id を取得し、手入力を上書きしないよう除外する。
    const { data: existingTimes, error: existingError } = await supabaseAdmin
      .from("carpool_route_times")
      .select("node_id")
      .eq("route_id", route.id)
      .eq("club_id", club.id);
    if (existingError) return ERR.serverError(existingError.message);
    const existingNodeIds = new Set((existingTimes ?? []).map((t) => t.node_id));

    const insertRows = venueTimes
      .filter((t) => !existingNodeIds.has(t.nodeId))
      .map((t) => ({
        club_id: club.id,
        route_id: route.id,
        node_id: t.nodeId,
        minutes_to_venue: timesByNode.get(t.nodeId) as number,
      }));
    if (insertRows.length === 0) continue;

    const { error: insError } = await supabaseAdmin
      .from("carpool_route_times")
      .insert(insertRows);
    if (insError) return ERR.serverError(insError.message);
    totalInserted += insertRows.length;
  }

  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_route_times",
    recordId: id,
    action: "update",
    payload: { routeCount: (routes ?? []).length, inserted: totalInserted },
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  return NextResponse.json({
    count: totalInserted,
    routeCount: (routes ?? []).length,
    osrmOk: durations.length > 0,
    ...(durations.length === 0
      ? { message: "自動計算サーバーに接続できませんでした" }
      : {}),
  });
}
