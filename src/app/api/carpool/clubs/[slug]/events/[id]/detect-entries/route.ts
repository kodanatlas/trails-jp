import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readEntryIndex } from "@/lib/entry-index-store";
import { detectEntriesForEvent, type ExistingMemberRef } from "@/lib/carpool/entry-detect";
import { ERR, resolveClub } from "@/lib/carpool/api/helpers";

export const dynamic = "force-dynamic";

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

  const { data: members, error: membersError } = await supabaseAdmin
    .from("carpool_members")
    .select("id, athlete_key")
    .eq("club_id", club.id);
  if (membersError) return ERR.serverError(membersError.message);

  const existingMembers: ExistingMemberRef[] = (members ?? []).map((m) => ({
    id: m.id,
    athleteKey: m.athlete_key ?? null,
  }));

  const { generatedAt, detected } = await detectEntriesForEvent(
    event.joe_event_id,
    club.joe_club_names,
    existingMembers,
    readEntryIndex,
  );

  return NextResponse.json({ generatedAt, detected }, { headers: CACHE_HEADERS });
}
