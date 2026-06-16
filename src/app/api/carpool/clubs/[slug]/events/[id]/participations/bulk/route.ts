import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { participationBulkSchema } from "@/lib/carpool/api/schemas";
import { normalizeNameKey } from "@/lib/name-key";
import { toMemberDTO, toParticipationDTO } from "@/lib/carpool/api/mappers";
import type { MemberDTO, ParticipationDTO } from "@/lib/carpool/api/mappers";
import {
  ERR,
  zodError,
  guardWrite,
  writeChangeLog,
  resolveClub,
  assertOwnedByClub,
} from "@/lib/carpool/api/helpers";
import {
  planBulkParticipations,
  indexMembersByKey,
  type ResolvedBulkEntry,
} from "@/lib/carpool/bulk-plan";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST /api/carpool/clubs/[slug]/events/[id]/participations/bulk
 * 検出パネルからの一括参加登録。
 *
 * body:  { actorName, entries: [{ memberId?, newMember?: { displayName, athleteKey }, className? }] }
 * res:   { created, members: MemberDTO[], participations: ParticipationDTO[] }（201）
 *   - members         … 今回新規作成した member の DTO 配列
 *   - participations  … 今 event の対象 member 全行（新規 insert 分 + 既存スキップ分）の DTO 配列
 *   - created         … 新規作成した参加行数
 *
 * 役割は固定 'undecided'（回答待ち）・entry_source='auto'。既存参加行がある member は
 * role を上書きしない（planBulkParticipations が skip 判定）。
 *
 * トランザクション性: 既存コード（members route の M2 方針）に倣い、単一 RPC 化は Phase 3 送り。
 * member insert 成功は即 change_log に記録する。途中失敗時は作成済み分はログに残り、
 * エラーレスポンスを返す（ベストエフォート）。
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

  const parsed = participationBulkSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  // 既存メンバー参照（memberId 指定行）の所有権を検証。イベントも検証。
  const existingMemberIds = input.entries
    .map((e) => e.memberId)
    .filter((v): v is string => typeof v === "string");
  const denied = await assertOwnedByClub(club.id, {
    events: [id],
    members: existingMemberIds,
  });
  if (denied) return denied;

  // ---------------------------------------------------------------------------
  // 重複作成防止の最後の砦（指摘1）: 同 club 内の active member を 1 回取得し、
  // athlete_key / normalizeNameKey(display_name) の二重索引を作る。newMember 作成前に
  // 同キーの既存 active member が居れば、新規作成せずその id を再利用する。
  // バッチ内で新規作成した member も索引に追加し、同名の newMember が複数あっても 1 人に収束させる。
  // ---------------------------------------------------------------------------
  const { data: clubMembers, error: clubMembersErr } = await supabaseAdmin
    .from("carpool_members")
    .select("id, athlete_key, display_name, active")
    .eq("club_id", club.id)
    .eq("active", true);
  if (clubMembersErr) return ERR.serverError(clubMembersErr.message);

  // 正準キー索引（pure: indexMembersByKey）。athlete_key 優先・先勝ち。
  const memberIdByKey = indexMembersByKey(
    (clubMembers ?? []).map((m) => ({
      id: m.id as string,
      athleteKey: (m.athlete_key as string | null) ?? null,
      displayName: (m.display_name as string | null) ?? null,
    })),
  );
  // バッチ内で新規作成した member を索引に足すための糖衣（pure 索引と同じ先勝ち規則）。
  const indexKey = (key: string | null | undefined, id: string) => {
    if (!key) return;
    const k = normalizeNameKey(key);
    if (k && !memberIdByKey.has(k)) memberIdByKey.set(k, id);
  };

  // ---------------------------------------------------------------------------
  // 1) 新規メンバー作成（newMember 指定行）。1件ずつ insert し、成功で即 change_log。
  //    athleteKey は検出 nameKey をそのまま渡す前提（自動紐付け）。
  //    ただし同キーの既存 active member が居れば再利用する（重複作成防止）。
  // ---------------------------------------------------------------------------
  const createdMembers: MemberDTO[] = [];
  // entries の各行を「解決済み memberId + className」に変換するための作業用。
  const resolved: (ResolvedBulkEntry & { newMemberRow: any | null })[] = [];

  for (const e of input.entries) {
    if (e.newMember) {
      // 既存 active member（athlete_key or 表示名キー一致）が居れば再利用。
      const lookupKey = normalizeNameKey(e.newMember.athleteKey);
      const existingId = memberIdByKey.get(lookupKey);
      if (existingId) {
        resolved.push({
          memberId: existingId,
          className: e.className ?? null,
          newMemberRow: null,
        });
        continue;
      }

      const insertRow: Record<string, unknown> = {
        club_id: club.id,
        display_name: e.newMember.displayName,
        athlete_key: e.newMember.athleteKey,
        has_car: false,
      };
      const { data: member, error } = await supabaseAdmin
        .from("carpool_members")
        .insert(insertRow)
        .select("*")
        .single();
      if (error) {
        // 23505 等の衝突（現状 athlete_key にユニーク制約は無いが念のため）。
        if (error.code === "23505") {
          return ERR.conflict("そのメンバーは既に存在します");
        }
        return ERR.serverError(error.message);
      }
      await writeChangeLog({
        clubId: club.id,
        tableName: "carpool_members",
        recordId: member.id,
        action: "insert",
        payload: member,
        actorName: guard.ctx.actorName,
        ipHash: guard.ctx.ipHash,
      });
      // 同一バッチ内の後続 newMember が同名を指したときに再利用できるよう索引へ追加。
      indexKey(member.athlete_key as string, member.id as string);
      if (member.display_name) indexKey(member.display_name as string, member.id as string);
      // Auto-assign homeNodeId from club defaultStations mapping.
      const defaultStations = (club.settings as Record<string, unknown>)?.defaultStations;
      if (defaultStations && typeof defaultStations === "object") {
        const dsMap = defaultStations as Record<string, string>;
        const memberName = member.display_name as string;
        // Find station by surname prefix match
        let stationName: string | undefined;
        for (const [surname, station] of Object.entries(dsMap)) {
          if (memberName.startsWith(surname)) {
            stationName = station;
            break;
          }
        }
        if (stationName) {
          // Look up existing area node
          const { data: areaNode } = await supabaseAdmin
            .from("carpool_nodes")
            .select("id")
            .eq("club_id", club.id)
            .eq("kind", "area")
            .eq("name", stationName)
            .maybeSingle();

          const homeNodeId = areaNode?.id as string | undefined;
          if (homeNodeId) {
            await supabaseAdmin
              .from("carpool_members")
              .update({ home_node_id: homeNodeId })
              .eq("id", member.id);
          }
        }
      }
      createdMembers.push(toMemberDTO(member, []));
      resolved.push({
        memberId: member.id as string,
        className: e.className ?? null,
        newMemberRow: member,
      });
    } else {
      // memberId は refine で必ず存在（newMember と排他・どちらか必須）。
      resolved.push({
        memberId: e.memberId as string,
        className: e.className ?? null,
        newMemberRow: null,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 2) 参加 upsert。既存参加行がある member は role を上書きしないため、
  //    既存集合を 1 クエリで取得し、planBulkParticipations で insert/skip に振り分ける。
  // ---------------------------------------------------------------------------
  const targetMemberIds = [...new Set(resolved.map((r) => r.memberId))];

  const { data: existingRows, error: existingErr } = await supabaseAdmin
    .from("carpool_participations")
    .select("member_id")
    .eq("event_id", id)
    .eq("club_id", club.id)
    .in("member_id", targetMemberIds);
  if (existingErr) return ERR.serverError(existingErr.message);

  const existingSet = new Set<string>(
    (existingRows ?? []).map((r: any) => r.member_id as string),
  );

  const { toInsert } = planBulkParticipations(resolved, existingSet);

  let created = 0;
  if (toInsert.length > 0) {
    const insertRows = toInsert.map((r) => ({
      club_id: club.id,
      event_id: id,
      member_id: r.memberId,
      role: "undecided" as const,
      entry_source: "auto" as const,
      class_name: r.className,
    }));
    const { data: insertedRows, error: insertErr } = await supabaseAdmin
      .from("carpool_participations")
      .insert(insertRows)
      .select("*");
    if (insertErr) {
      if (insertErr.code === "23505") {
        return ERR.conflict("その参加状況は既に存在します");
      }
      return ERR.serverError(insertErr.message);
    }
    created = (insertedRows ?? []).length;
    for (const row of insertedRows ?? []) {
      await writeChangeLog({
        clubId: club.id,
        tableName: "carpool_participations",
        recordId: row.id,
        action: "insert",
        payload: row,
        actorName: guard.ctx.actorName,
        ipHash: guard.ctx.ipHash,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 3) レスポンス: 今 event の対象 member 全行を再 select（insert 分 + 既存スキップ分）。
  // ---------------------------------------------------------------------------
  const { data: finalRows, error: finalErr } = await supabaseAdmin
    .from("carpool_participations")
    .select("*")
    .eq("event_id", id)
    .eq("club_id", club.id)
    .in("member_id", targetMemberIds);
  if (finalErr) return ERR.serverError(finalErr.message);

  const participations: ParticipationDTO[] = (finalRows ?? []).map(toParticipationDTO);

  return NextResponse.json(
    { created, members: createdMembers, participations },
    { status: 201 },
  );
}

/* eslint-enable @typescript-eslint/no-explicit-any */
