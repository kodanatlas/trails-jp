import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { travelTimesAutoSchema } from "@/lib/carpool/api/schemas";
import { toTravelTimeDTO } from "@/lib/carpool/api/mappers";
import { ERR, zodError, guardWrite, writeChangeLog, resolveClub } from "@/lib/carpool/api/helpers";
import { TRAVEL_TIMES_BATCH_LIMIT } from "@/lib/carpool/api/constants";
import {
  fetchOsrmTable,
  buildAutoUpserts,
  sanitizeGeoNodes,
  type GeoNode,
  type ExistingTravelTime,
} from "@/lib/carpool/osrm";

export const dynamic = "force-dynamic";

/**
 * D1: POST /api/carpool/clubs/[slug]/travel-times/auto — 移動時間の自動計算。
 *
 * 座標つきノード間の car（OSRM）と transit（haversine 推定）を、
 * 未入力ペアのみ source='osrm'/'api' で埋める（manual を含む既存値は保護）。
 * OSRM 不達時は transit 推定のみ。両方ゼロなら日本語案内を返す。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ERR.invalidBody();
  }

  const parsed = travelTimesAutoSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  // 1) 当該クラブの全ノードから、座標つき（lat/lng とも非 null）のものを GeoNode 化。
  const { data: nodeRows, error: nodesError } = await supabaseAdmin
    .from("carpool_nodes")
    .select("id, lat, lng")
    .eq("club_id", club.id);
  if (nodesError) return ERR.serverError(nodesError.message);

  const rawGeoNodes: GeoNode[] = (nodeRows ?? [])
    .filter((n) => n.lat != null && n.lng != null)
    .map((n) => ({ id: n.id, lat: Number(n.lat), lng: Number(n.lng) }));

  // 日本ドメイン外の座標（履歴の不良データ）を計算から除外し、swap は自動補正する。
  const { ok: geoNodes, dropped } = sanitizeGeoNodes(rawGeoNodes);
  // dropped 件数を日本語警告として応答 message に付け足す（既存フィールドは維持）。
  const droppedSuffix =
    dropped.length > 0 ? `（座標が日本国外の場所${dropped.length}件は除外しました）` : "";

  if (geoNodes.length < 2) {
    return NextResponse.json({
      count: 0,
      car: 0,
      transit: 0,
      geoNodeCount: geoNodes.length,
      message: `座標つきの場所が2件未満です。マスタで座標を取得してください${droppedSuffix}`,
    });
  }

  // 2) 既存 travel_times を ExistingTravelTime[] に（manual/osrm/api いずれも保護対象）。
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("carpool_travel_times")
    .select("from_node_id, to_node_id, mode, source")
    .eq("club_id", club.id);
  if (existingError) return ERR.serverError(existingError.message);

  const existing: ExistingTravelTime[] = (existingRows ?? []).map((r) => ({
    fromNodeId: r.from_node_id,
    toNodeId: r.to_node_id,
    mode: r.mode,
    source: r.source,
  }));

  // 3) OSRM を 1 回だけ叩く（失敗時は空配列 → car は組まれず transit のみ）。
  const durations = await fetchOsrmTable(geoNodes);

  // 4) 未入力ペアのみ埋める upsert を組み立てる。
  const { car, transit, all } = buildAutoUpserts(geoNodes, durations, existing);

  // OSRM 不達かつ書く対象なし（transit も全て既存）→ 接続案内。
  if (all.length === 0 && durations.length === 0) {
    return NextResponse.json({
      count: 0,
      car: 0,
      transit: 0,
      osrmOk: false,
      message: `自動計算サーバーに接続できませんでした。マスタで手入力してください${droppedSuffix}`,
    });
  }

  // 5) all を TRAVEL_TIMES_BATCH_LIMIT 件ずつチャンクして upsert。
  //    node id はすべて DB 由来のためクラブ所有権検証は不要（assertOwnedByClub 省略）。
  const now = new Date().toISOString();
  const rows = all.map((e) => ({
    club_id: club.id,
    from_node_id: e.fromNodeId,
    to_node_id: e.toNodeId,
    mode: e.mode,
    minutes: e.minutes,
    source: e.source,
    updated_at: now,
  }));

  const upserted: unknown[] = [];
  for (let i = 0; i < rows.length; i += TRAVEL_TIMES_BATCH_LIMIT) {
    const chunk = rows.slice(i, i + TRAVEL_TIMES_BATCH_LIMIT);
    const { data, error } = await supabaseAdmin
      .from("carpool_travel_times")
      .upsert(chunk, { onConflict: "club_id,from_node_id,to_node_id,mode" })
      .select("*");
    if (error) return ERR.serverError(error.message);
    for (const r of data ?? []) upserted.push(r);
  }

  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_travel_times",
    recordId: null,
    action: "update",
    payload: { autoCount: all.length, car: car.length, transit: transit.length },
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  return NextResponse.json({
    count: all.length,
    car: car.length,
    transit: transit.length,
    osrmOk: durations.length > 0,
    travelTimes: upserted.map(toTravelTimeDTO),
    // 国外座標を除外した場合のみ案内を付ける（成功応答のフィールドは増やさない方針）。
    ...(dropped.length > 0
      ? { message: `移動時間を自動計算しました${droppedSuffix}` }
      : {}),
  });
}
