import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  participationCreateSchema,
  participationUpdateSchema,
  seatsToCapacity,
} from "@/lib/carpool/api/schemas";
import { toParticipationDTO } from "@/lib/carpool/api/mappers";
import {
  ERR,
  zodError,
  guardWrite,
  writeChangeLog,
  resolveClub,
  assertOwnedByClub,
} from "@/lib/carpool/api/helpers";
import type { ParticipationCreateInput, ParticipationUpdateInput } from "@/lib/carpool/api/schemas";

export const dynamic = "force-dynamic";

/** GET /api/carpool/clubs/[slug]/events/[id]/participations — 参加状況一覧。 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  const { data, error } = await supabaseAdmin
    .from("carpool_participations")
    .select("*")
    .eq("event_id", id)
    .eq("club_id", club.id);
  if (error) return ERR.serverError(error.message);

  return NextResponse.json({ participations: (data ?? []).map(toParticipationDTO) });
}

/** body の参照（イベント・メンバー・pickup ノード）が当該クラブ所有かを検証。 */
async function assertParticipationRefs(
  clubId: string,
  eventId: string,
  input: ParticipationCreateInput | ParticipationUpdateInput,
): Promise<NextResponse | null> {
  return assertOwnedByClub(clubId, {
    events: [eventId],
    members: [input.memberId, input.fixedDriverMemberId],
    nodes: (input.pickupPrefsOverride ?? []).map((p) => p.nodeId),
  });
}

/** 既存の参加行を取得（event_id + member_id + club_id）。無ければ null。 */
async function findExistingParticipation(
  clubId: string,
  eventId: string,
  memberId: string,
): Promise<{ row: Record<string, unknown> | null; error: string | null }> {
  const { data, error } = await supabaseAdmin
    .from("carpool_participations")
    .select("*")
    .eq("event_id", eventId)
    .eq("member_id", memberId)
    .eq("club_id", clubId)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: data ?? null, error: null };
}

/**
 * POST /api/carpool/clubs/[slug]/events/[id]/participations — 参加状況 upsert（全列）。
 * 既存有無で changelog の action を実体決定し、payload は { before, after }。
 */
export async function POST(
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

  const parsed = participationCreateSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  const denied = await assertParticipationRefs(club.id, id, input);
  if (denied) return denied;

  // 既存行を取得し、action を HTTP メソッドではなく実体で決定する。
  const { row: before, error: findError } = await findExistingParticipation(
    club.id,
    id,
    input.memberId,
  );
  if (findError) return ERR.serverError(findError);

  const row: Record<string, unknown> = {
    club_id: club.id,
    event_id: id,
    member_id: input.memberId,
    role: input.role,
    capacity_override: seatsToCapacity(input.capacityOverrideSeats),
    willingness: input.willingness ?? null,
    earliest_departure_override: input.earliestDepartureOverride ?? null,
    fixed_driver_member_id: input.fixedDriverMemberId ?? null,
    pickup_prefs_override: input.pickupPrefsOverride ?? null,
    start_time: input.startTime ?? null,
    class_name: input.className ?? null,
    est_course_min: input.estCourseMin ?? null,
    entry_source: input.entrySource ?? "manual",
    notes: input.notes ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from("carpool_participations")
    .upsert(row, { onConflict: "event_id,member_id" })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return ERR.conflict("その参加状況は既に存在します");
    return ERR.serverError(error.message);
  }

  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_participations",
    recordId: data.id,
    action: before ? "update" : "insert",
    payload: { before, after: data },
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  return NextResponse.json({ participation: toParticipationDTO(data) }, { status: 201 });
}

/**
 * PATCH /api/carpool/clubs/[slug]/events/[id]/participations — 真の部分更新。
 * 既存行が無ければ 404。提供されたフィールド（!== undefined）のみ更新し、明示 null はクリアとして通す。
 */
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

  const parsed = participationUpdateSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  const denied = await assertParticipationRefs(club.id, id, input);
  if (denied) return denied;

  const { row: before, error: findError } = await findExistingParticipation(
    club.id,
    id,
    input.memberId,
  );
  if (findError) return ERR.serverError(findError);
  if (!before) return ERR.notFound("参加情報");

  // 提供されたフィールドのみで update を構築（明示 null はクリアとして通す）。
  const patch: Record<string, unknown> = {};
  if (input.role !== undefined) patch.role = input.role;
  if (input.capacityOverrideSeats !== undefined) {
    patch.capacity_override = seatsToCapacity(input.capacityOverrideSeats);
  }
  if (input.willingness !== undefined) patch.willingness = input.willingness;
  if (input.earliestDepartureOverride !== undefined) {
    patch.earliest_departure_override = input.earliestDepartureOverride;
  }
  if (input.fixedDriverMemberId !== undefined) {
    patch.fixed_driver_member_id = input.fixedDriverMemberId;
  }
  if (input.pickupPrefsOverride !== undefined) {
    patch.pickup_prefs_override = input.pickupPrefsOverride;
  }
  if (input.startTime !== undefined) patch.start_time = input.startTime;
  if (input.className !== undefined) patch.class_name = input.className;
  if (input.estCourseMin !== undefined) patch.est_course_min = input.estCourseMin;
  if (input.entrySource !== undefined) patch.entry_source = input.entrySource;
  if (input.notes !== undefined) patch.notes = input.notes;

  // 更新フィールドが無ければ既存をそのまま返す（無駄な書込みとログを避ける）。
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ participation: toParticipationDTO(before) });
  }

  const { data, error } = await supabaseAdmin
    .from("carpool_participations")
    .update(patch)
    .eq("event_id", id)
    .eq("member_id", input.memberId)
    .eq("club_id", club.id)
    .select("*")
    .single();
  if (error) return ERR.serverError(error.message);

  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_participations",
    recordId: data.id,
    action: "update",
    payload: { before, after: data },
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  return NextResponse.json({ participation: toParticipationDTO(data) });
}

/** UUID v4 形式の簡易検証（zod の z.string().uuid() と同等の緩さ）。 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/carpool/clubs/[slug]/events/[id]/participations?memberId=<uuid>&actorName=<name>
 * 物理削除（誤検出・キャンセル用）。before 行を全列 change_log に残す。
 *
 * DELETE は body を持たないのが普通（fetchCarpool も DELETE 時は body を送らない）ため、
 * memberId / actorName は **クエリパラメータ**で受ける。両方必須。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  const memberId = req.nextUrl.searchParams.get("memberId");
  const actorName = req.nextUrl.searchParams.get("actorName")?.trim() ?? "";
  if (!memberId || !UUID_RE.test(memberId) || actorName.length === 0) {
    return ERR.invalidBody();
  }

  const guard = await guardWrite(req, club, actorName);
  if ("response" in guard) return guard.response;

  const denied = await assertOwnedByClub(club.id, {
    events: [id],
    members: [memberId],
  });
  if (denied) return denied;

  const { row: before, error: findError } = await findExistingParticipation(
    club.id,
    id,
    memberId,
  );
  if (findError) return ERR.serverError(findError);
  if (!before) return ERR.notFound("参加情報");

  const { error } = await supabaseAdmin
    .from("carpool_participations")
    .delete()
    .eq("event_id", id)
    .eq("member_id", memberId)
    .eq("club_id", club.id);
  if (error) return ERR.serverError(error.message);

  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_participations",
    recordId: (before.id as string | null) ?? null,
    action: "delete",
    payload: before,
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  return NextResponse.json({ deleted: true });
}
