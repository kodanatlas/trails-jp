import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { nodeGeocodeSchema } from "@/lib/carpool/api/schemas";
import { toNodeDTO } from "@/lib/carpool/api/mappers";
import { ERR, zodError, guardWrite, writeChangeLog, resolveClub, resolveClubGeoRef } from "@/lib/carpool/api/helpers";
import { geocodeAddress } from "@/lib/carpool/geocode";

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
  let hit = null;
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
    payload: { geocoded: true, source: "gsi", lat: hit.lat, lng: hit.lng },
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  return NextResponse.json({ node: toNodeDTO(updated), geocoded: true });
}
