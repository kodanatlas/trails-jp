import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { clubCreateSchema } from "@/lib/carpool/api/schemas";
import { toClubDTO } from "@/lib/carpool/api/mappers";
import { ERR, zodError, guardWrite, writeChangeLog } from "@/lib/carpool/api/helpers";

export const dynamic = "force-dynamic";

/** GET /api/carpool/clubs — クラブ一覧（クラブ選択ページ用）。 */
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("carpool_clubs")
    .select("*")
    .order("name", { ascending: true });
  if (error) return ERR.serverError(error.message);
  return NextResponse.json({ clubs: (data ?? []).map(toClubDTO) });
}

/** POST /api/carpool/clubs — クラブ作成（FR-0: 誰でも追加可）。 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ERR.invalidBody();
  }

  const parsed = clubCreateSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error.issues);
  const input = parsed.data;

  const guard = await guardWrite(req, null, input.actorName);
  if ("response" in guard) return guard.response;

  const { data, error } = await supabaseAdmin
    .from("carpool_clubs")
    .insert({
      name: input.name,
      slug: input.slug,
      joe_club_names: input.joeClubNames,
      settings: input.settings ?? {},
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return ERR.conflict("その slug は既に使われています");
    return ERR.serverError(error.message);
  }

  await writeChangeLog({
    clubId: data.id,
    tableName: "carpool_clubs",
    recordId: data.id,
    action: "insert",
    payload: data,
    actorName: guard.ctx.actorName,
    ipHash: guard.ctx.ipHash,
  });

  return NextResponse.json({ club: toClubDTO(data) }, { status: 201 });
}
