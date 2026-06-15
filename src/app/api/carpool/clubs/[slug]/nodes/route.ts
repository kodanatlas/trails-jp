import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { nodeCreateSchema } from "@/lib/carpool/api/schemas";
import { toNodeDTO } from "@/lib/carpool/api/mappers";
import { ERR, zodError, guardWrite, writeChangeLog, resolveClub, resolveClubGeoRef } from "@/lib/carpool/api/helpers";
import { geocodeAddressDetailed } from "@/lib/carpool/geocode";
import { shouldGeocodeNodeKind } from "@/lib/carpool/venue-coords";

export const dynamic = "force-dynamic";

/** GET /api/carpool/clubs/[slug]/nodes — ノード一覧（?kind= で絞り込み）。 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  const kind = req.nextUrl.searchParams.get("kind");

  let query = supabaseAdmin
    .from("carpool_nodes")
    .select("*")
    .eq("club_id", club.id);
  if (kind) query = query.eq("kind", kind);

  const { data, error } = await query
    .order("kind", { ascending: true })
    .order("name", { ascending: true });
  if (error) return ERR.serverError(error.message);

  return NextResponse.json({ nodes: (data ?? []).map(toNodeDTO) });
}

/** POST /api/carpool/clubs/[slug]/nodes — ノード作成。 */
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

  const parsed = nodeCreateSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  const insertRow: Record<string, unknown> = {
    club_id: club.id,
    kind: input.kind,
    name: input.name,
  };
  if (input.lat !== undefined) insertRow.lat = input.lat;
  if (input.lng !== undefined) insertRow.lng = input.lng;
  if (input.parking !== undefined) insertRow.parking = input.parking;
  if (input.note !== undefined) insertRow.note = input.note;

  const { data, error } = await supabaseAdmin
    .from("carpool_nodes")
    .insert(insertRow)
    .select("*")
    .single();
  if (error) return ERR.serverError(error.message);

  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_nodes",
    recordId: data.id,
    action: "insert",
    payload: data,
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  // C1: 座標未指定（lat/lng とも null）なら名称でジオコーディングして自動補完する。
  // 失敗・候補ゼロ・例外は隔離し、座標 null のまま（=ノード作成は壊さない）。
  // ただし kind='venue' は除外: 会場は JOY の地図ピンが正で、会場名ジオコーディングは
  // 曖昧で約8kmずれる実害があるため自動付与しない（座標は events 作成時の scrape か地図ピッカーで入る）。
  let node = data;
  // 名称ジオコーディングが走り採用された解決先（GSI title）と入力名の完全一致。
  // UI が exact=false のとき「『入力』→『解決先』に設定しました」確認バナーを出すために返す。
  let geocodeInfo: { resolvedTitle: string; exact: boolean } | null = null;
  if (node.lat == null && node.lng == null && shouldGeocodeNodeKind(node.kind)) {
    try {
      // 同名異地の誤選択を防ぐ参照点（クラブ既存ノード重心）。作成直後の自ノードは除外。
      // resolveClubGeoRef はエラー時 null を返すためノード作成を壊さない。
      const ref = await resolveClubGeoRef(club.id, { excludeNodeId: node.id });
      const hit = await geocodeAddressDetailed(node.name, { ref: ref ?? undefined });
      if (hit) {
        const { data: updated, error: updateError } = await supabaseAdmin
          .from("carpool_nodes")
          .update({ lat: hit.lat, lng: hit.lng })
          .eq("id", node.id)
          .eq("club_id", club.id)
          .select("*")
          .single();
        if (!updateError && updated) {
          node = updated;
          geocodeInfo = { resolvedTitle: hit.title, exact: hit.exact };
          await writeChangeLog({
            clubId: club.id,
            tableName: "carpool_nodes",
            recordId: node.id,
            action: "update",
            payload: { geocoded: true, source: "gsi", lat: hit.lat, lng: hit.lng },
            actorName: guard.ctx.actorName,
            ipHash: guard.ctx.ipHash,
          });
        }
      }
    } catch {
      // ジオコーディング失敗はノード作成に影響させない（座標 null のまま）。
    }
  }

  // geocode は名称解決が走り命中した場合のみ非 null（DB スキーマ変更なし・レスポンスのみ）。
  return NextResponse.json({ node: toNodeDTO(node), geocode: geocodeInfo }, { status: 201 });
}
