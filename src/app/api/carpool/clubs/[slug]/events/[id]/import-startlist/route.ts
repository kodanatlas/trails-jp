import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  ERR,
  jsonError,
  zodError,
  guardWrite,
  writeChangeLog,
  resolveClub,
  assertOwnedByClub,
} from "@/lib/carpool/api/helpers";
import { toParticipationDTO, type ParticipationDTO } from "@/lib/carpool/api/mappers";
import { importStartlistSchema } from "@/lib/carpool/api/startlist-schemas";
import {
  parseStartlistText,
  extractStartlistFromPdf,
  matchStartlistRows,
  buildApplyTargets,
  isAllowedStartlistUrl,
  type StartlistRow,
  type StartlistMatch,
  type ExistingMemberRef,
  type ImportOverride,
} from "@/lib/carpool/startlist";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** PDF 取得の上限サイズ（10MB）。スタートリスト PDF はこれを十分下回る。 */
const PDF_MAX_BYTES = 10 * 1024 * 1024;
/** URL 取得のウォールクロック予算（maxDuration 60s に対し余裕を残す）。 */
const FETCH_BUDGET_MS = 45_000;

/**
 * POST /api/carpool/clubs/[slug]/events/[id]/import-startlist
 *
 * スタートリスト（URL の PDF / 貼り付けテキスト）を解析・クラブ員突合し、
 * プレビュー（apply=false）または participation への反映（apply=true）を行う。
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

  const parsed = importStartlistSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  // 大会取得（joe 連携不要 — URL/貼付があれば動く）。
  const { data: event, error: eventError } = await supabaseAdmin
    .from("carpool_events")
    .select("id, club_id")
    .eq("id", id)
    .eq("club_id", club.id)
    .maybeSingle();
  if (eventError) return ERR.serverError(eventError.message);
  if (!event) return ERR.notFound("大会");

  // メンバー（突合用）。
  const { data: memberRows, error: membersError } = await supabaseAdmin
    .from("carpool_members")
    .select("id, athlete_key, display_name")
    .eq("club_id", club.id);
  if (membersError) return ERR.serverError(membersError.message);

  const members: ExistingMemberRef[] = (memberRows ?? []).map((m) => ({
    id: m.id,
    athleteKey: m.athlete_key ?? null,
    displayName: m.display_name ?? null,
  }));

  // 行抽出（pastedText / url）。
  let rows: StartlistRow[];
  if (input.pastedText != null) {
    rows = parseStartlistText([input.pastedText]);
  } else {
    // url != null（refine 保証）。m2: SSRF 対策 — JOY ドメイン以外は取得しない。
    const url = input.url as string;
    if (!isAllowedStartlistUrl(url)) {
      return jsonError("URL は japan-o-entry.com のもののみ指定できます", 400);
    }
    const fetched = await fetchStartlistPdf(url);
    if ("response" in fetched) return fetched.response;
    rows = await extractStartlistFromPdf(fetched.data);
  }

  if (rows.length === 0) {
    return NextResponse.json({
      matches: [],
      message: "スタートリストを検出できませんでした",
    });
  }

  const matches = matchStartlistRows(rows, club.joe_club_names, members);

  // ---- プレビュー（書込みなし）----
  if (!input.apply) {
    return NextResponse.json({ matches });
  }

  // ---- 反映 ----
  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  return applyMatches(club.id, id, matches, input.overrides ?? [], {
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });
}

/**
 * 突合結果を participation の start_time / class_name に反映する。
 * 反映対象の決定は buildApplyTargets（純粋・テスト対象）に委譲する:
 *   - participation がある member のみ更新。未参加・メンバー未特定は skipped。
 *   - B1: undefined の列は UPDATE しない（部分更新。手入力値を空値で潰さない）。
 *   - M1: surname（姓のみ一致）は override（ユーザー確認）がある行のみ反映。
 */
async function applyMatches(
  clubId: string,
  eventId: string,
  matches: StartlistMatch[],
  overrides: ReadonlyArray<ImportOverride>,
  ctx: { actorName: string; ipHash: string },
): Promise<NextResponse> {
  // この event の既存 participation（更新対象判定用）。
  const { data: partRows, error: partError } = await supabaseAdmin
    .from("carpool_participations")
    .select("member_id")
    .eq("event_id", eventId)
    .eq("club_id", clubId);
  if (partError) return ERR.serverError(partError.message);
  const participatingMemberIds = new Set<string>(
    (partRows ?? []).map((p) => p.member_id as string),
  );

  const { targets, skipped } = buildApplyTargets(matches, overrides, participatingMemberIds);

  if (targets.length === 0) {
    return NextResponse.json({ updated: [], skipped });
  }

  // 所有権検証（event + 反映対象 member 群）。
  const memberIds = targets.map((t) => t.memberId);
  const owned = await assertOwnedByClub(clubId, { events: [eventId], members: memberIds });
  if (owned) return owned;

  const updated: ParticipationDTO[] = [];
  for (const t of targets) {
    // before 取得（change_log payload 用）。
    const { data: before, error: beforeError } = await supabaseAdmin
      .from("carpool_participations")
      .select("*")
      .eq("event_id", eventId)
      .eq("member_id", t.memberId)
      .eq("club_id", clubId)
      .maybeSingle();
    if (beforeError) return ERR.serverError(beforeError.message);
    if (!before) {
      // participating セット取得後に消えた等のレース（m3: 未参加とは理由を分ける）。
      skipped.push({
        rawName: t.rawName,
        className: t.className ?? "",
        reason: "反映中に対象が変化しました。再試行してください",
      });
      continue;
    }

    // B1: undefined の列は触らない（部分更新）。role・entry_source・他列は不変。
    const patch: Record<string, unknown> = {};
    if (t.startTime !== undefined) patch.start_time = t.startTime;
    if (t.className !== undefined) patch.class_name = t.className;

    const { data: after, error: updateError } = await supabaseAdmin
      .from("carpool_participations")
      .update(patch)
      .eq("event_id", eventId)
      .eq("member_id", t.memberId)
      .eq("club_id", clubId)
      .select("*")
      .single();
    if (updateError) return ERR.serverError(updateError.message);

    await writeChangeLog({
      clubId,
      tableName: "carpool_participations",
      recordId: after.id,
      action: "update",
      payload: { before, after },
      actorName: ctx.actorName,
      ipHash: ctx.ipHash,
    });

    updated.push(toParticipationDTO(after));
  }

  return NextResponse.json({ updated, skipped });
}

/**
 * URL から PDF を取得し Uint8Array で返す。
 * Content-Length が 10MB 超なら 400、ヘッダ欠如時はストリームで 10MB 超過を検知して中断。
 * 取得失敗は日本語の 502/500。ウォールクロックは AbortSignal.timeout で管理。
 */
async function fetchStartlistPdf(
  url: string,
): Promise<{ data: Uint8Array } | { response: NextResponse }> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "trails.jp/1.0 (carpool startlist)" },
      signal: AbortSignal.timeout(FETCH_BUDGET_MS),
      // 解析は常に最新を見たいのでキャッシュしない。
      cache: "no-store",
    });
  } catch {
    return { response: jsonError("スタートリストの取得に失敗しました", 502) };
  }

  if (!res.ok) {
    return { response: jsonError("スタートリストの取得に失敗しました", 502) };
  }

  // Content-Length が分かるなら先に上限チェック。
  const lenHeader = res.headers.get("content-length");
  if (lenHeader) {
    const len = Number(lenHeader);
    if (Number.isFinite(len) && len > PDF_MAX_BYTES) {
      return { response: jsonError("ファイルが大きすぎます（10MB以内）", 400) };
    }
  }

  // ストリームで読みつつ 10MB 超過を検知して中断（Content-Length 欠如・過小申告対策）。
  if (!res.body) {
    try {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > PDF_MAX_BYTES) {
        return { response: jsonError("ファイルが大きすぎます（10MB以内）", 400) };
      }
      return { data: buf };
    } catch {
      return { response: jsonError("スタートリストの読み込みに失敗しました", 500) };
    }
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > PDF_MAX_BYTES) {
          await reader.cancel();
          return { response: jsonError("ファイルが大きすぎます（10MB以内）", 400) };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { response: jsonError("スタートリストの読み込みに失敗しました", 500) };
  }

  const data = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.byteLength;
  }
  return { data };
}
