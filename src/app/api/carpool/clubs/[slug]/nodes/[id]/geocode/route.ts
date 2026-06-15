import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { nodeGeocodeSchema } from "@/lib/carpool/api/schemas";
import { toNodeDTO } from "@/lib/carpool/api/mappers";
import { ERR, zodError, guardWrite, writeChangeLog, resolveClub, resolveClubGeoRef } from "@/lib/carpool/api/helpers";
import { geocodeAddress } from "@/lib/carpool/geocode";
import { shouldGeocodeNodeKind } from "@/lib/carpool/venue-coords";
import { scrapeEventCoordinates } from "@/lib/scraper/events";
import { readEvents } from "@/lib/events-store";

export const dynamic = "force-dynamic";

/**
 * C3: POST /api/carpool/clubs/[slug]/nodes/[id]/geocode — 座標の再取得（マスタの「再取得」ボタン）。
 *
 * node.name でジオコーディングし直し、命中したら lat/lng を更新する。
 * 命中しなかった場合は座標を変更せず 200 + geocoded:false + 日本語案内を返す。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  const { data: existing, error: findError } = await supabaseAdmin
    .from("carpool_nodes")
    .select("*")
    .eq("id", id)
    .eq("club_id", club.id)
    .maybeSingle();
  if (findError) return ERR.serverError(findError.message);
  if (!existing) return ERR.notFound("場所");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ERR.invalidBody();
  }

  const parsed = nodeGeocodeSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  // 外部呼び出しは失敗を隔離（null 扱い）。手動入力導線を案内に残す。
  // 経路は kind で分岐: venue は JOY の地図ピン（scrapeEventCoordinates）で再取得し、
  // 会場名ジオコーディング（曖昧で約8kmずれる）は使わない。area/pickup は従来どおり名前で引く。
  let hit: { lat: number; lng: number } | null = null;
  let source = "gsi";

  if (!shouldGeocodeNodeKind(existing.kind)) {
    // --- venue: この会場ノードを参照する大会の joe_url から JOY ピンを取り直す ---
    source = "joy";
    const { data: linkedEvents, error: evErr } = await supabaseAdmin
      .from("carpool_events")
      .select("joe_event_id")
      .eq("club_id", club.id)
      .eq("venue_node_id", id)
      .not("joe_event_id", "is", null)
      .limit(1);
    if (evErr) return ERR.serverError(evErr.message);
    const joeEventId = (linkedEvents ?? [])[0]?.joe_event_id ?? null;

    let joeUrl: string | null = null;
    if (joeEventId !== null && joeEventId !== undefined) {
      try {
        const events = await readEvents();
        joeUrl = events.find((e) => e.joe_event_id === joeEventId)?.joe_url ?? null;
      } catch {
        joeUrl = null;
      }
    }

    if (!joeUrl) {
      // JOY 由来でない（手動作成）会場は地図ピンが無い。地図ピッカーへ誘導する。
      return NextResponse.json({
        node: toNodeDTO(existing),
        geocoded: false,
        message: "会場は地図で位置を調整してください",
      });
    }

    try {
      hit = await scrapeEventCoordinates(joeUrl);
    } catch {
      hit = null;
    }

    if (!hit) {
      return NextResponse.json({
        node: toNodeDTO(existing),
        geocoded: false,
        message: "JOYの地図から座標を取得できませんでした。地図で位置を調整してください",
      });
    }
  } else {
    // --- area / pickup: 従来どおり名称ジオコーディング ---
    try {
      // 再ジオコーディング対象の自ノード（北海道目黒のような遠地誤座標を持ちうる）は
      // 参照点の重心から必ず除外する。さもないと誤座標が自分を引き寄せて補正できない。
      const ref = await resolveClubGeoRef(club.id, { excludeNodeId: id });
      hit = await geocodeAddress(existing.name, { ref: ref ?? undefined });
    } catch {
      hit = null;
    }

    if (!hit) {
      return NextResponse.json({
        node: toNodeDTO(existing),
        geocoded: false,
        message: "座標が見つかりませんでした。名称を確認するか手動で入力してください",
      });
    }
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("carpool_nodes")
    .update({ lat: hit.lat, lng: hit.lng })
    .eq("id", id)
    .eq("club_id", club.id)
    .select("*")
    .single();
  if (updateError) return ERR.serverError(updateError.message);

  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_nodes",
    recordId: id,
    action: "update",
    payload: { geocoded: true, source, lat: hit.lat, lng: hit.lng },
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  return NextResponse.json({ node: toNodeDTO(updated), geocoded: true });
}
