import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  planCreateSchema,
  toPlanMetaDTO,
  toPlanCarDTO,
  toPlanRiderDTO,
  type PlanRiderDTO,
  type PlanDetailDTO,
} from "@/lib/carpool/api/plan-schemas";
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

/**
 * GET /api/carpool/clubs/[slug]/events/[id]/plans
 *   - ?status=published&latest=1 → 最新の公開版（cars/riders 込み）。無ければ { plan: null }。
 *   - それ以外 → 版一覧（meta のみ、新しい順）。?status= で絞り込み可。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  // イベントが当該クラブのものか確認。
  const { data: event, error: eventError } = await supabaseAdmin
    .from("carpool_events")
    .select("id")
    .eq("id", id)
    .eq("club_id", club.id)
    .maybeSingle();
  if (eventError) return ERR.serverError(eventError.message);
  if (!event) return ERR.notFound("大会");

  const statusParam = req.nextUrl.searchParams.get("status");
  const latest = req.nextUrl.searchParams.get("latest") === "1";

  if (latest) {
    // 最新版（status 絞り込み可）を1件、cars/riders 込みで返す。
    let q = supabaseAdmin
      .from("carpool_plans")
      .select("*")
      .eq("event_id", id)
      .eq("club_id", club.id)
      .order("version", { ascending: false })
      .limit(1);
    if (statusParam) q = q.eq("status", statusParam);
    const { data: plans, error } = await q;
    if (error) return ERR.serverError(error.message);
    const plan = (plans ?? [])[0];
    if (!plan) return NextResponse.json({ plan: null });

    const detail = await loadPlanDetail(plan, club.id);
    if ("error" in detail) return ERR.serverError(detail.error);
    return NextResponse.json({ plan: detail.plan });
  }

  // 版一覧（meta のみ）。
  let listQ = supabaseAdmin
    .from("carpool_plans")
    .select("*")
    .eq("event_id", id)
    .eq("club_id", club.id)
    .order("version", { ascending: false });
  if (statusParam) listQ = listQ.eq("status", statusParam);
  const { data: plans, error } = await listQ;
  if (error) return ERR.serverError(error.message);

  return NextResponse.json({ plans: (plans ?? []).map(toPlanMetaDTO) });
}

/**
 * POST /api/carpool/clubs/[slug]/events/[id]/plans — 配車案を1版保存する。
 * version はサーバで max+1。plan + plan_cars + plan_riders を insert。
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

  const parsed = planCreateSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  // B1: 参照する UUID が当該クラブ所有かを検証。
  // cars/riders に加え、locks 内の member/node/route も対象にする（jsonb 保存され
  // GET で返るため、他クラブ UUID の混入を許さない）。
  const planMemberIds: string[] = []; // cars/riders 由来（参加者検証にも使う）
  const memberRefs: string[] = [];
  const routeRefs: string[] = [];
  const nodeRefs: string[] = [];
  for (const car of input.cars) {
    planMemberIds.push(car.driverMemberId);
    if (car.routeId) routeRefs.push(car.routeId);
    for (const n of car.pickupNodeIds) nodeRefs.push(n);
    for (const r of car.riders) {
      planMemberIds.push(r.memberId);
      nodeRefs.push(r.nodeId);
    }
  }
  memberRefs.push(...planMemberIds);
  for (const lk of input.locks) {
    memberRefs.push(lk.driverId);
    if (lk.memberId) memberRefs.push(lk.memberId);
    if (lk.nodeId) nodeRefs.push(lk.nodeId);
    if (lk.routeId) routeRefs.push(lk.routeId);
  }
  const denied = await assertOwnedByClub(club.id, {
    members: memberRefs,
    routes: routeRefs,
    nodes: nodeRefs,
  });
  if (denied) return denied;

  // 配車案の member（driver/rider）が当該イベントの参加者かを検証する
  // （クラブ所有だけでは、エントリーしていない member を含むプランを保存できてしまう）。
  const uniquePlanMembers = [...new Set(planMemberIds)];
  if (uniquePlanMembers.length > 0) {
    const { data: parts, error: partsError } = await supabaseAdmin
      .from("carpool_participations")
      .select("member_id")
      .eq("event_id", id)
      .eq("club_id", club.id)
      .in("member_id", uniquePlanMembers);
    if (partsError) return ERR.serverError(partsError.message);
    const partSet = new Set((parts ?? []).map((r) => r.member_id as string));
    if (uniquePlanMembers.some((m) => !partSet.has(m))) {
      return jsonError("配車案にこの大会の参加登録がないメンバーが含まれています", 400);
    }
  }

  // version = 同イベント・同 kind 内の max+1（unique 制約も (event_id, kind, version)）。
  // SELECT→INSERT の2段構成は同時 POST で衝突し得るため、status='draft' で insert し、
  // 23505（ユニーク違反）なら1回だけ再採番してリトライ、それでも衝突なら 409 を返す。
  const nextVersion = async (): Promise<number | NextResponse> => {
    const { data: maxRow, error: maxError } = await supabaseAdmin
      .from("carpool_plans")
      .select("version")
      .eq("event_id", id)
      .eq("club_id", club.id)
      .eq("kind", input.kind)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxError) return ERR.serverError(maxError.message);
    return (maxRow?.version ?? 0) + 1;
  };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  let plan: any = null;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  for (let attempt = 0; attempt < 2; attempt++) {
    const version = await nextVersion();
    if (typeof version !== "number") return version;
    const { data, error } = await supabaseAdmin
      .from("carpool_plans")
      .insert({
        club_id: club.id,
        event_id: id,
        version,
        kind: input.kind,
        // 壊れた最新公開版を作らないため、まず draft で insert し、
        // cars/riders がすべて成功した後に要求 status へ更新する。
        status: "draft",
        locks: input.locks,
        weights: input.weights,
        kpi: input.kpi,
      })
      .select("*")
      .single();
    if (!error) {
      plan = data;
      break;
    }
    if (error.code === "23505") {
      if (attempt === 0) continue; // 採番競合 → 再採番して1回だけリトライ
      return ERR.conflict("同時に保存が行われました。もう一度お試しください");
    }
    return ERR.serverError(error.message);
  }
  if (!plan) return ERR.serverError("配車案の保存に失敗しました");

  // 子テーブル insert 失敗時の補償削除（ベストエフォート）。
  // plan 行は draft のままなので結果ページ（published&latest=1）には決して出ないが、
  // 版番号の歯抜け・ゴミ行を残さないため削除を試みる。
  const rollback = async () => {
    await supabaseAdmin
      .from("carpool_plan_riders")
      .delete()
      .eq("plan_id", plan.id)
      .eq("club_id", club.id);
    await supabaseAdmin
      .from("carpool_plan_cars")
      .delete()
      .eq("plan_id", plan.id)
      .eq("club_id", club.id);
    await supabaseAdmin
      .from("carpool_plans")
      .delete()
      .eq("id", plan.id)
      .eq("club_id", club.id);
  };

  // 2) plan_cars を insert（運転手ごと）。
  if (input.cars.length > 0) {
    const carRows = input.cars.map((c) => ({
      club_id: club.id,
      plan_id: plan.id,
      driver_member_id: c.driverMemberId,
      route_id: c.routeId ?? null,
      pickup_node_ids: c.pickupNodeIds,
      departure_time: c.departureTime ?? null,
      arrival_time: c.arrivalTime ?? null,
      cost_yen: c.costYen ?? null,
      recommended_departure: c.recommendedDeparture ?? null,
    }));
    const { error: carsError } = await supabaseAdmin
      .from("carpool_plan_cars")
      .insert(carRows);
    if (carsError) {
      await rollback();
      return jsonError("配車案の保存に失敗しました。もう一度お試しください", 500);
    }

    // 3) plan_riders を insert（全車ぶんまとめて）。
    const riderRows = input.cars.flatMap((c) =>
      c.riders.map((r) => ({
        club_id: club.id,
        plan_id: plan.id,
        member_id: r.memberId,
        car_driver_member_id: c.driverMemberId,
        pickup_node_id: r.nodeId,
        board_time: r.boardTime ?? null,
        locked: r.locked ?? false,
      })),
    );
    if (riderRows.length > 0) {
      const { error: ridersError } = await supabaseAdmin
        .from("carpool_plan_riders")
        .insert(riderRows);
      if (ridersError) {
        await rollback();
        return jsonError("配車案の保存に失敗しました。もう一度お試しください", 500);
      }
    }
  }

  // 4) 全データ完備後に要求 status へ更新（published の場合のみ）。
  if (input.status === "published") {
    const { data: updated, error: updError } = await supabaseAdmin
      .from("carpool_plans")
      .update({ status: "published" })
      .eq("id", plan.id)
      .eq("club_id", club.id)
      .select("*")
      .single();
    if (updError) {
      // データは完備しており draft として残る（結果ページには影響しない）。
      return jsonError(
        "配車案は下書きとして保存されましたが、公開への切替に失敗しました。もう一度「この案を公開」を押してください",
        500,
      );
    }
    plan = updated;
  }

  // 監査ログ（全 insert/update の成功後にまとめて記録。失敗時は rollback 済みで行が無い）。
  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_plans",
    recordId: plan.id,
    action: "insert",
    payload: plan,
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });
  if (input.cars.length > 0) {
    await writeChangeLog({
      clubId: club.id,
      tableName: "carpool_plan_cars",
      recordId: plan.id,
      action: "insert",
      payload: { planId: plan.id, cars: input.cars },
      actorName: guard.ctx.actorName,
      ipHash: guard.ctx.ipHash,
    });
  }

  const detail = await loadPlanDetail(plan, club.id);
  if ("error" in detail) return ERR.serverError(detail.error);
  return NextResponse.json({ plan: detail.plan }, { status: 201 });
}

// ---------------------------------------------------------------------------
// 内部: plan 行 → cars/riders 込み詳細 DTO を組み立てる。
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadPlanDetail(
  planRow: any,
  clubId: string,
): Promise<{ plan: PlanDetailDTO } | { error: string }> {
  const { data: carRows, error: carsError } = await supabaseAdmin
    .from("carpool_plan_cars")
    .select("*")
    .eq("plan_id", planRow.id)
    .eq("club_id", clubId);
  if (carsError) return { error: carsError.message };

  const { data: riderRows, error: ridersError } = await supabaseAdmin
    .from("carpool_plan_riders")
    .select("*")
    .eq("plan_id", planRow.id)
    .eq("club_id", clubId);
  if (ridersError) return { error: ridersError.message };

  const ridersByCar = new Map<string, PlanRiderDTO[]>();
  for (const r of riderRows ?? []) {
    const dto = toPlanRiderDTO(r);
    const list = ridersByCar.get(dto.carDriverMemberId) ?? [];
    list.push(dto);
    ridersByCar.set(dto.carDriverMemberId, list);
  }

  const cars = (carRows ?? []).map((c) =>
    toPlanCarDTO(c, ridersByCar.get(c.driver_member_id) ?? []),
  );

  return { plan: { ...toPlanMetaDTO(planRow), cars } };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
