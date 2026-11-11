import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { clubUpdateSchema } from "@/lib/carpool/api/schemas";
import { toClubDTO } from "@/lib/carpool/api/mappers";
import { ERR, zodError, guardWrite, writeChangeLog, resolveClub } from "@/lib/carpool/api/helpers";

export const dynamic = "force-dynamic";

/** GET /api/carpool/clubs/[slug] — クラブ詳細。 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");
  return NextResponse.json({ club: toClubDTO(club) });
}

/** PATCH /api/carpool/clubs/[slug] — クラブ設定の部分更新（settings は浅くマージ）。 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await resolveClub(slug);
  if (!club) return ERR.notFound("クラブ");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ERR.invalidBody();
  }

  const parsed = clubUpdateSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, club, input.actorName);
  if ("response" in guard) return guard.response;

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.joeClubNames !== undefined) patch.joe_club_names = input.joeClubNames;
  if (input.settings !== undefined) {
    patch.settings = { ...(club.settings ?? {}), ...input.settings };
  }

  const { data, error } = await supabaseAdmin
    .from("carpool_clubs")
    .update(patch)
    .eq("id", club.id)
    .select("*")
    .single();

  if (error) return ERR.serverError(error.message);

  await writeChangeLog({
    clubId: club.id,
    tableName: "carpool_clubs",
    recordId: club.id,
    action: "update",
    payload: data,
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  return NextResponse.json({ club: toClubDTO(data) });
}
