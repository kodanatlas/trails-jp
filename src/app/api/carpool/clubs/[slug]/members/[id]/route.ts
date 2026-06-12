import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { memberUpdateSchema, seatsToCapacity } from "@/lib/carpool/api/schemas";
import { toMemberDTO, type PickupPrefDTO } from "@/lib/carpool/api/mappers";
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

/** PATCH /api/carpool/clubs/[slug]/members/[id] — メンバー更新（active=論理削除, pickupPrefs 全置換）。 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  const { data: existing, error: findError } = await supabaseAdmin
    .from("carpool_members")
    .select("*")
    .eq("id", id)
    .eq("club_id", club.id)
    .maybeSingle();
  if (findError) return ERR.serverError(findError.message);
  if (!existing) return ERR.notFound("メンバー");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ERR.invalidBody();
  }

  const parsed = memberUpdateSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  // B1: homeNodeId と pickupPrefs[].nodeId が当該クラブ所有かを検証（対象 member の club 一致は上で確認済み）。
  const denied = await assertOwnedByClub(club.id, {
    nodes: [input.homeNodeId, ...(input.pickupPrefs ?? []).map((p) => p.nodeId)],
  });
  if (denied) return denied;

  const patch: Record<string, unknown> = {};
  if (input.displayName !== undefined) patch.display_name = input.displayName;
  if (input.athleteKey !== undefined) patch.athlete_key = input.athleteKey;
  if (input.homeNodeId !== undefined) patch.home_node_id = input.homeNodeId;
  if (input.hasCar !== undefined) patch.has_car = input.hasCar;
  if (input.seatsAvailable !== undefined) patch.default_capacity = seatsToCapacity(input.seatsAvailable);
  if (input.defaultWillingness !== undefined) patch.default_willingness = input.defaultWillingness;
  if (input.earliestDeparture !== undefined) patch.earliest_departure = input.earliestDeparture;
  if (input.luggageInCar !== undefined) patch.luggage_in_car = input.luggageInCar;
  if (input.active !== undefined) patch.active = input.active;

  let member = existing;
  if (Object.keys(patch).length > 0) {
    const { data, error } = await supabaseAdmin
      .from("carpool_members")
      .update(patch)
      .eq("id", id)
      .eq("club_id", club.id)
      .select("*")
      .single();
    if (error) return ERR.serverError(error.message);
    member = data;
  }

  // M2: member 更新を即ログ（後続の prefs 置換が失敗しても member 変更は監査に残す）。
  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_members",
    recordId: id,
    action: "update",
    payload: member,
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  // pickupPrefs が指定された場合（空配列含む）は全置換。
  let pickupPrefs: PickupPrefDTO[] | undefined;
  if (input.pickupPrefs !== undefined) {
    // 旧 prefs を before として先に取得（復元・changelog 用）。
    const { data: oldPrefRows, error: oldPrefsError } = await supabaseAdmin
      .from("carpool_driver_pickup_prefs")
      .select("*")
      .eq("member_id", id)
      .eq("club_id", club.id);
    if (oldPrefsError) return ERR.serverError(oldPrefsError.message);
    const before = (oldPrefRows ?? []).map((p) => ({ nodeId: p.node_id, strength: p.strength }));

    // nodeId 重複は後勝ち dedupe してから書く。
    const dedupedMap = new Map<string, { nodeId: string; strength: "hard" | "soft" }>();
    for (const p of input.pickupPrefs) dedupedMap.set(p.nodeId, p);
    const deduped = [...dedupedMap.values()];

    const { error: delError } = await supabaseAdmin
      .from("carpool_driver_pickup_prefs")
      .delete()
      .eq("member_id", id)
      .eq("club_id", club.id);
    if (delError) return ERR.serverError(delError.message);

    if (deduped.length > 0) {
      const prefRows = deduped.map((p) => ({
        club_id: club.id,
        member_id: id,
        node_id: p.nodeId,
        strength: p.strength,
      }));
      const { error: insError } = await supabaseAdmin
        .from("carpool_driver_pickup_prefs")
        .insert(prefRows);
      if (insError) {
        // 置換 insert 失敗 → 旧行をベストエフォートで再 insert して状態を復元。
        // 恒久対応（delete+insert の RPC トランザクション化）は Phase 3 送り。
        if ((oldPrefRows ?? []).length > 0) {
          await supabaseAdmin.from("carpool_driver_pickup_prefs").insert(oldPrefRows as unknown[]);
        }
        return jsonError("ピックアップ希望の更新に失敗しました。再度お試しください", 500);
      }
    }
    pickupPrefs = deduped.map((p) => ({ nodeId: p.nodeId, strength: p.strength }));

    await writeChangeLog({
      clubId: club.id,
      tableName: "carpool_driver_pickup_prefs",
      recordId: id,
      action: "update",
      payload: { before, after: pickupPrefs },
      actorName: guard.ctx.actorName,
      ipHash: guard.ctx.ipHash,
    });
  } else {
    const { data: prefs, error: prefsError } = await supabaseAdmin
      .from("carpool_driver_pickup_prefs")
      .select("*")
      .eq("member_id", id)
      .eq("club_id", club.id);
    if (prefsError) return ERR.serverError(prefsError.message);
    pickupPrefs = (prefs ?? []).map((p) => ({ nodeId: p.node_id, strength: p.strength }));
  }

  return NextResponse.json({ member: toMemberDTO(member, pickupPrefs) });
}
