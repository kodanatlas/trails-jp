import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { nodeUpdateSchema } from "@/lib/carpool/api/schemas";
import { toNodeDTO } from "@/lib/carpool/api/mappers";
import { ERR, zodError, guardWrite, writeChangeLog, resolveClub } from "@/lib/carpool/api/helpers";

export const dynamic = "force-dynamic";

/** PATCH /api/carpool/clubs/[slug]/nodes/[id] — ノード更新。 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  const { data: existing, error: findError } = await supabaseAdmin
    .from("carpool_nodes")
    .select("*")
    .eq("id", id)
    .eq("club_id", club.id)
    .maybeSingle();
  if (findError) return ERR.serverError(findError.message);
  if (!existing) return ERR.notFound("ノード");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ERR.invalidBody();
  }

  const parsed = nodeUpdateSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  const patch: Record<string, unknown> = {};
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.name !== undefined) patch.name = input.name;
  if (input.lat !== undefined) patch.lat = input.lat;
  if (input.lng !== undefined) patch.lng = input.lng;
  if (input.parking !== undefined) patch.parking = input.parking;
  if (input.note !== undefined) patch.note = input.note;

  const { data, error } = await supabaseAdmin
    .from("carpool_nodes")
    .update(patch)
    .eq("id", id)
    .eq("club_id", club.id)
    .select("*")
    .single();
  if (error) return ERR.serverError(error.message);

  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_nodes",
    recordId: id,
    action: "update",
    payload: data,
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  return NextResponse.json({ node: toNodeDTO(data) });
}
