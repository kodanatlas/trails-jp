import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { memberCreateSchema, seatsToCapacity } from "@/lib/carpool/api/schemas";
import { normalizeNameKey } from "@/lib/name-key";
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

/** GET /api/carpool/clubs/[slug]/members — メンバー一覧（pickupPrefs 同梱）。 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  const { data: members, error } = await supabaseAdmin
    .from("carpool_members")
    .select("*")
    .eq("club_id", club.id)
    .order("display_name", { ascending: true });
  if (error) return ERR.serverError(error.message);

  const { data: prefs, error: prefsError } = await supabaseAdmin
    .from("carpool_driver_pickup_prefs")
    .select("*")
    .eq("club_id", club.id);
  if (prefsError) return ERR.serverError(prefsError.message);

  const prefsByMember = new Map<string, PickupPrefDTO[]>();
  for (const p of prefs ?? []) {
    const list = prefsByMember.get(p.member_id) ?? [];
    list.push({ nodeId: p.node_id, strength: p.strength });
    prefsByMember.set(p.member_id, list);
  }

  const dto = (members ?? []).map((m) => toMemberDTO(m, prefsByMember.get(m.id) ?? []));
  return NextResponse.json({ members: dto });
}

/** POST /api/carpool/clubs/[slug]/members — メンバー作成。 */
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

  const parsed = memberCreateSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  // B1: homeNodeId と pickupPrefs[].nodeId が当該クラブ所有かを検証。
  const denied = await assertOwnedByClub(club.id, {
    nodes: [input.homeNodeId, ...(input.pickupPrefs ?? []).map((p) => p.nodeId)],
  });
  if (denied) return denied;

  // D: homeAreaName 指定かつ homeNodeId 未指定のとき、kind='area' のノードを
  // 再利用 or 作成し、その id を home_node_id に使う（UI からノード概念を隠すための糖衣）。
  // homeNodeId が指定されていれば homeAreaName は無視する（homeNodeId 優先）。
  let resolvedHomeNodeId: string | null | undefined = input.homeNodeId;
  if (
    input.homeAreaName !== undefined &&
    (input.homeNodeId === undefined || input.homeNodeId === null)
  ) {
    const areaName = input.homeAreaName; // schema で trim 済み
    const { data: existingArea, error: findAreaErr } = await supabaseAdmin
      .from("carpool_nodes")
      .select("*")
      .eq("club_id", club.id)
      .eq("kind", "area")
      .eq("name", areaName)
      .maybeSingle();
    if (findAreaErr) return ERR.serverError(findAreaErr.message);

    if (existingArea) {
      resolvedHomeNodeId = existingArea.id;
    } else {
      const { data: areaNode, error: areaErr } = await supabaseAdmin
        .from("carpool_nodes")
        .insert({ club_id: club.id, kind: "area", name: areaName })
        .select("*")
        .single();
      if (areaErr) return ERR.serverError(areaErr.message);
      resolvedHomeNodeId = areaNode.id;
      await writeChangeLog({
        clubId: club.id,
        tableName: "carpool_nodes",
        recordId: areaNode.id,
        action: "insert",
        payload: areaNode,
        actorName: guard.ctx.actorName,
        ipHash: guard.ctx.ipHash,
      });
    }
  }

  // 名前の重複防止（指摘1）: athleteKey 未指定なら displayName の正準キーを自動設定する。
  // これにより、セットアップガイド/ActorModal の自己登録で作った member と
  // JOY 検出（detect-entries）の同一人物が、突合キーで一致するようになる。
  const resolvedAthleteKey =
    input.athleteKey !== undefined && input.athleteKey !== null
      ? input.athleteKey
      : normalizeNameKey(input.displayName) || null;

  const insertRow: Record<string, unknown> = {
    club_id: club.id,
    display_name: input.displayName,
    default_capacity: seatsToCapacity(input.seatsAvailable),
  };
  if (resolvedAthleteKey) insertRow.athlete_key = resolvedAthleteKey;
  if (resolvedHomeNodeId !== undefined) insertRow.home_node_id = resolvedHomeNodeId;
  if (input.hasCar !== undefined) insertRow.has_car = input.hasCar;
  if (input.defaultWillingness !== undefined) insertRow.default_willingness = input.defaultWillingness;
  if (input.earliestDeparture !== undefined) insertRow.earliest_departure = input.earliestDeparture;
  if (input.luggageInCar !== undefined) insertRow.luggage_in_car = input.luggageInCar;

  const { data: member, error } = await supabaseAdmin
    .from("carpool_members")
    .insert(insertRow)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return ERR.conflict("そのメンバーは既に存在します");
    return ERR.serverError(error.message);
  }

  // M2: 成功した DB 書込みは即ログ（member insert 成功時点で記録し、後続失敗でも監査に残す）。
  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_members",
    recordId: member.id,
    action: "insert",
    payload: member,
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  let pickupPrefs: PickupPrefDTO[] = [];
  if (input.pickupPrefs && input.pickupPrefs.length > 0) {
    const prefRows = input.pickupPrefs.map((p) => ({
      club_id: club.id,
      member_id: member.id,
      node_id: p.nodeId,
      strength: p.strength,
    }));
    const { error: prefError } = await supabaseAdmin
      .from("carpool_driver_pickup_prefs")
      .insert(prefRows);
    // member は作成済み（ログ済み）。prefs だけ失敗した場合は 500 を返す。
    // 恒久対応（member+prefs を単一 RPC でトランザクション化）は Phase 3 送り。
    if (prefError) {
      return jsonError("メンバーは作成されましたが、ピックアップ希望の保存に失敗しました", 500);
    }
    pickupPrefs = input.pickupPrefs.map((p) => ({ nodeId: p.nodeId, strength: p.strength }));
    await writeChangeLog({
      clubId: club.id,
      tableName: "carpool_driver_pickup_prefs",
      recordId: member.id,
      action: "insert",
      payload: { memberId: member.id, prefs: pickupPrefs },
      actorName: guard.ctx.actorName,
      ipHash: guard.ctx.ipHash,
    });
  }

  return NextResponse.json({ member: toMemberDTO(member, pickupPrefs) }, { status: 201 });
}
