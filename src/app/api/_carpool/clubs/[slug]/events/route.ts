import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readEvents } from "@/lib/events-store";
import { eventCreateSchema } from "@/lib/carpool/api/schemas";
import { toEventDTO, toNodeDTO, type NodeDTO } from "@/lib/carpool/api/mappers";
import { ERR, zodError, guardWrite, writeChangeLog, resolveClub } from "@/lib/carpool/api/helpers";
import { DEFAULT_BUFFER_MIN } from "@/lib/carpool/api/constants";
import { resolveVenueCoordsWithScrape } from "@/lib/carpool/venue-coords";
import { scrapeEventCoordinates } from "@/lib/scraper/events";

export const dynamic = "force-dynamic";

/** GET /api/carpool/clubs/[slug]/events — 大会一覧（開催日降順）。 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  const { data, error } = await supabaseAdmin
    .from("carpool_events")
    .select("*")
    .eq("club_id", club.id)
    .order("event_date", { ascending: false });
  if (error) return ERR.serverError(error.message);

  return NextResponse.json({ events: (data ?? []).map(toEventDTO) });
}

/** POST /api/carpool/clubs/[slug]/events — 大会作成（joeEventId 指定時は自動補完 + venue ノード生成/再利用）。 */
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

  const parsed = eventCreateSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  let name: string;
  let eventDate: string;
  let venueNodeId: string | null = null;
  let venueNodeDTO: NodeDTO | undefined;

  if (input.joeEventId !== null && input.joeEventId !== undefined) {
    const events = await readEvents();
    const joe = events.find((e) => e.joe_event_id === input.joeEventId);
    if (!joe) return ERR.notFound("大会");

    name = input.name ?? joe.name;
    eventDate = input.eventDate ?? joe.date;

    // 会場座標の決定: store座標(joe.lat/lng) → JOY地図ピン(scrapeEventCoordinates) → null。
    // store が null のことは多く（座標は遅延バッチ任せ）、その場合は JOY 詳細ページの
    // Leaflet ピンを取りに行く。会場名のジオコーディングは曖昧で約8kmずれるため**使わない**。
    // scrape は失敗・タイムアウトを隔離（events.ts 側で UA 明示・例外時 null / 本体でも try 隔離）。
    const venueCoords = await resolveVenueCoordsWithScrape(
      { lat: joe.lat, lng: joe.lng },
      joe.joe_url,
      scrapeEventCoordinates,
    );

    if (joe.venue) {
      // 同名 venue が2件以上あっても 500 にしないよう maybeSingle ではなく limit(1)+先頭参照。
      const { data: existingNodes, error: nodeFindError } = await supabaseAdmin
        .from("carpool_nodes")
        .select("*")
        .eq("club_id", club.id)
        .eq("kind", "venue")
        .eq("name", joe.venue)
        .limit(1);
      if (nodeFindError) return ERR.serverError(nodeFindError.message);
      const existingNode = (existingNodes ?? [])[0];

      if (existingNode) {
        // 再利用時は新規作成でないため changelog 不要。
        venueNodeId = existingNode.id;
        venueNodeDTO = toNodeDTO(existingNode);
      } else {
        const { data: newNode, error: nodeInsError } = await supabaseAdmin
          .from("carpool_nodes")
          .insert({
            club_id: club.id,
            kind: "venue",
            name: joe.venue || joe.name,
            lat: venueCoords.lat,
            lng: venueCoords.lng,
          })
          .select("*")
          .single();
        if (nodeInsError) return ERR.serverError(nodeInsError.message);
        venueNodeId = newNode.id;
        venueNodeDTO = toNodeDTO(newNode);
        // M2: venue ノード自動作成も監査記録（node insert 成功直後にログ）。
        await writeChangeLog({
          clubId: club.id,
          tableName: "carpool_nodes",
          recordId: newNode.id,
          action: "insert",
          payload: newNode,
          actorName: guard.ctx.actorName,
          ipHash: guard.ctx.ipHash,
        });
      }
    } else {
      // venue 名が無い場合でも JOE 由来の名前でノードを生成しておく。
      const { data: newNode, error: nodeInsError } = await supabaseAdmin
        .from("carpool_nodes")
        .insert({
          club_id: club.id,
          kind: "venue",
          name: joe.name,
          lat: venueCoords.lat,
          lng: venueCoords.lng,
        })
        .select("*")
        .single();
      if (nodeInsError) return ERR.serverError(nodeInsError.message);
      venueNodeId = newNode.id;
      venueNodeDTO = toNodeDTO(newNode);
      // M2: venue ノード自動作成も監査記録。
      await writeChangeLog({
        clubId: club.id,
        tableName: "carpool_nodes",
        recordId: newNode.id,
        action: "insert",
        payload: newNode,
        actorName: guard.ctx.actorName,
        ipHash: guard.ctx.ipHash,
      });
    }
  } else {
    if (!input.name || !input.eventDate) return ERR.invalidBody();
    name = input.name;
    eventDate = input.eventDate;
  }

  const insertRow: Record<string, unknown> = {
    club_id: club.id,
    joe_event_id: input.joeEventId ?? null,
    name,
    event_date: eventDate,
    venue_node_id: venueNodeId,
    buffer_min: input.bufferMin ?? DEFAULT_BUFFER_MIN,
  };
  if (input.bulletinUrl !== undefined) insertRow.bulletin_url = input.bulletinUrl;
  if (input.startlistUrl !== undefined) insertRow.startlist_url = input.startlistUrl;

  const { data: event, error } = await supabaseAdmin
    .from("carpool_events")
    .insert(insertRow)
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return ERR.conflict("その大会は既に登録されています");
    return ERR.serverError(error.message);
  }

  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_events",
    recordId: event.id,
    action: "insert",
    payload: event,
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  return NextResponse.json(
    { event: toEventDTO(event), ...(venueNodeDTO ? { venueNode: venueNodeDTO } : {}) },
    { status: 201 },
  );
}
