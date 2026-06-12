import { NextResponse, type NextRequest } from "next/server";
import { readEvents } from "@/lib/events-store";
import { EVENTS_SEARCH_LIMIT } from "@/lib/carpool/api/constants";

export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300",
};

/**
 * GET /api/carpool/events-search?q=xxx — JOE 大会を名称で検索（開催日が今日に近い順）。
 * クラブ非依存。大会作成フォームの候補補完に使う。
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();

  const events = await readEvents();
  const today = Date.now();

  const filtered = q
    ? events.filter((e) => e.name.toLowerCase().includes(q))
    : events;

  const sorted = filtered
    .slice()
    .sort((a, b) => {
      const da = Math.abs(new Date(a.date).getTime() - today);
      const db = Math.abs(new Date(b.date).getTime() - today);
      return da - db;
    })
    .slice(0, EVENTS_SEARCH_LIMIT);

  return NextResponse.json(
    {
      events: sorted.map((e) => ({
        joeEventId: e.joe_event_id,
        name: e.name,
        date: e.date,
        venue: e.venue ?? null,
        prefecture: e.prefecture,
        lat: e.lat ?? null,
        lng: e.lng ?? null,
        joeUrl: e.joe_url,
      })),
    },
    { headers: CACHE_HEADERS },
  );
}
