import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ERR, resolveClub } from "@/lib/carpool/api/helpers";
import { scrapeDocuments, type JoeDocument } from "@/lib/scraper/documents";

export const dynamic = "force-dynamic";

// 大会ごとの発行書類は JOY 側の更新で変わり、UI は最新を見たいので no-store。
const CACHE_HEADERS = {
  "Cache-Control": "no-store",
};

const JOE_BASE_URL = "https://japan-o-entry.com";

/**
 * GET /api/carpool/clubs/[slug]/events/[id]/documents
 * JOY 大会ページの「発行書類」リンク（要綱・スタートリスト等）を返す。
 *
 * - joe 連携が無い大会は 200 + 空配列 + 案内メッセージ（UI が握りやすいよう常に 200）。
 * - 取得失敗（例外）も 200 + 空配列 + 失敗メッセージ。
 */
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

  // joe_event_id（主）か joe_url（あれば）から大会ページ URL を組み立てる。
  // どちらも無ければ JOY 連携なし → 空配列を 200 で返す。
  const joeUrl = resolveJoeUrl(event);
  if (!joeUrl) {
    return NextResponse.json(
      { documents: [], message: "この大会は JOY と連携していません" },
      { headers: CACHE_HEADERS },
    );
  }

  try {
    const documents: JoeDocument[] = await scrapeDocuments(joeUrl);
    return NextResponse.json({ documents }, { headers: CACHE_HEADERS });
  } catch {
    return NextResponse.json(
      { documents: [], message: "発行書類の取得に失敗しました" },
      { headers: CACHE_HEADERS },
    );
  }
}

/** event 行から JOY 大会ページ URL を導出。joe_event_id 優先、無ければ joe_url、どちらも無ければ null。 */
function resolveJoeUrl(event: Record<string, unknown>): string | null {
  const joeEventId = event.joe_event_id;
  if (joeEventId !== null && joeEventId !== undefined) {
    return `${JOE_BASE_URL}/event/view/${joeEventId}`;
  }
  const joeUrl = event.joe_url;
  if (typeof joeUrl === "string" && joeUrl.length > 0) return joeUrl;
  return null;
}
