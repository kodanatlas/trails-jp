import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { nodeCreateSchema } from "@/lib/carpool/api/schemas";
import { toNodeDTO } from "@/lib/carpool/api/mappers";
import { ERR, zodError, guardWrite, writeChangeLog, resolveClub } from "@/lib/carpool/api/helpers";

export const dynamic = "force-dynamic";

/** GET /api/carpool/clubs/[slug]/nodes — ノード一覧（?kind= で絞り込み）。 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  const kind = req.nextUrl.searchParams.get("kind");

  let query = supabaseAdmin
    .from("carpool_nodes")
    .select("*")
    .eq("club_id", club.id);
  if (kind) query = query.eq("kind", kind);

  const { data, error } = await query
    .order("kind", { ascending: true })
    .order("name", { ascending: true });
  if (error) return ERR.serverError(error.message);

  return NextResponse.json({ nodes: (data ?? []).map(toNodeDTO) });
}

/** POST /api/carpool/clubs/[slug]/nodes — ノード作成。 */
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

  const parsed = nodeCreateSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  const insertRow: Record<string, unknown> = {
    club_id: club.id,
    kind: input.kind,
    name: input.name,
  };
  if (input.lat !== undefined) insertRow.lat = input.lat;
  if (input.lng !== undefined) insertRow.lng = input.lng;
  if (input.parking !== undefined) insertRow.parking = input.parking;
  if (input.note !== undefined) insertRow.note = input.note;

  const { data, error } = await supabaseAdmin
    .from("carpool_nodes")
    .insert(insertRow)
    .select("*")
    .single();
  if (error) return ERR.serverError(error.message);

  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_nodes",
    recordId: data.id,
    action: "insert",
    payload: data,
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  return NextResponse.json({ node: toNodeDTO(data) }, { status: 201 });
}
