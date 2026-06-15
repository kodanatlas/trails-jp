import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readEntryIndex } from "@/lib/entry-index-store";
import {
  detectEntriesForEvent,
  detectEntriesLive,
  type ExistingMemberRef,
} from "@/lib/carpool/entry-detect";
import { scrapeEntryListByEventId } from "@/lib/scraper/entry-source";
import { ERR, resolveClub } from "@/lib/carpool/api/helpers";

export const dynamic = "force-dynamic";
// ライブ取得フォールバック（JOY HTML 取得+解析）が走るため余裕を持たせる。
export const maxDuration = 30;

// クラブ別の検出結果はメンバー構成に依存し共有キャッシュ不可（PII 漏えい防止）のため no-store。
const CACHE_HEADERS = {
  "Cache-Control": "no-store",
};

/** GET /api/carpool/clubs/[slug]/events/[id]/detect-entries — エントリー自動検出（FR-3）。 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  const { data: event, error: eventError } = await supabaseAdmin
    .from("carpool_events")
    .select("*")
    .eq("id", id)
    .eq("club_id", club.id)
    .maybeSingle();
  if (eventError) return ERR.serverError(eventError.message);
  if (!event) return ERR.notFound("大会");

  if (event.joe_event_id === null || event.joe_event_id === undefined) {
    return NextResponse.json({ generatedAt: null, detected: [] }, { headers: CACHE_HEADERS });
  }

  // display_name も取得し、athlete_key 不一致時の突合フォールバック（指摘1）に使う。
  const { data: members, error: membersError } = await supabaseAdmin
    .from("carpool_members")
    .select("id, athlete_key, display_name")
    .eq("club_id", club.id);
  if (membersError) return ERR.serverError(membersError.message);

  const existingMembers: ExistingMemberRef[] = (members ?? []).map((m) => ({
    id: m.id,
    athleteKey: m.athlete_key ?? null,
    displayName: m.display_name ?? null,
  }));

  // 1) entry-index（cron 生成・高速）を主に使う。
  const indexResult = await detectEntriesForEvent(
    event.joe_event_id,
    club.joe_club_names,
    existingMembers,
    readEntryIndex,
  );
  let generatedAt = indexResult.generatedAt;
  let detected = indexResult.detected;

  // 2) index にこの大会が無い（開催日を過ぎて脱落・未同期・index 欠落）場合は
  //    JOY をライブ取得してフォールバック検出する。
  //    → 大会が過去になるとクラブ員候補が消えるリグレッションを防ぐ。
  if (!indexResult.eventInIndex) {
    try {
      const live = await detectEntriesLive(
        event.joe_event_id,
        club.joe_club_names,
        existingMembers,
        (eventId) => scrapeEntryListByEventId(eventId, { throwOnError: true }),
      );
      generatedAt = live.generatedAt;
      detected = live.detected;
    } catch (e) {
      // JOY 取得失敗時は index 結果（空）のまま返す（グレースフル劣化）。
      console.error(
        "detect-entries live fallback failed:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return NextResponse.json({ generatedAt, detected }, { headers: CACHE_HEADERS });
}
