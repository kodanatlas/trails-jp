import { NextResponse, type NextRequest } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ERR, resolveClub } from "@/lib/carpool/api/helpers";
import { scrapeDocuments, type JoeDocument } from "@/lib/scraper/documents";
import {
  isAllowedProgramUrl,
  normalizeDriveUrl,
} from "@/lib/carpool/startlist/url-allow";
import {
  extractVenueToStartCandidates,
  type VenueToStartCandidate,
} from "@/lib/carpool/venue-to-start";

export const dynamic = "force-dynamic";
// プログラムは 50MB 超・多ページのことがあり、抽出に時間がかかるため余裕を持って 60 秒。
export const maxDuration = 60;

const CACHE_HEADERS = { "Cache-Control": "no-store" };

const JOE_BASE_URL = "https://japan-o-entry.com";

// プログラム/要綱が載りやすい発行書類の種別（タイトル部分一致・大小無視・走査優先順）。
const DOC_TITLE_KEYWORDS = ["プログラム", "program", "要項", "要綱", "案内", "競技"];

// プログラム PDF のサイズ上限（実データ検証で 50MB 超があったため 80MB）。
const PDF_MAX_BYTES = 80 * 1024 * 1024;
const FETCH_BUDGET_MS = 55_000;
const MAX_CANDIDATES = 5;

const NO_HIT_MESSAGE =
  "プログラムから自動取得できませんでした。プログラムを見て手入力してください";

/** API レスポンスの候補1件（純粋関数の候補 + 出典）。 */
interface SuggestCandidate {
  minutes: number;
  context: string;
  source: string;
}

/**
 * POST /api/carpool/clubs/[slug]/events/[id]/venue-to-start-suggest
 *
 * プログラム/要綱 PDF を読み、会場→スタートの所要時間「候補」を best-effort で抽出する
 * （純粋部分は venue-to-start.ts の extractVenueToStartCandidates）。
 *
 * body:
 *   - programUrl?: string … 指定時はその URL を取得（JOY / Google Drive 可）。
 *     未指定時はイベントの発行書類（scrapeDocuments）をキーワード優先順で走査。
 *
 * 戻り値: { candidates: { minutes, context, source }[] }（最大5件・単一自動確定はしない）。
 * 取れなければ { candidates: [], message }。取得失敗・例外でも 200 で握る。
 * 認証なし運用・副作用なし（DB を更新しない＝change_log 不要）。
 */
export async function POST(
  req: NextRequest,
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

  // body は任意。programUrl のみ参照（その他は無視）。パース失敗は空 body 扱い。
  let programUrl: string | undefined;
  try {
    const body = (await req.json()) as { programUrl?: unknown };
    if (typeof body?.programUrl === "string" && body.programUrl.trim() !== "") {
      programUrl = body.programUrl.trim();
    }
  } catch {
    // body 無し（自動取得を発行書類から行う）。
  }

  try {
    // --- programUrl 指定: そのURLのみを取得・抽出する ---
    if (programUrl) {
      if (!isAllowedProgramUrl(programUrl)) {
        return NextResponse.json(
          {
            candidates: [],
            message:
              "対応していない URL です（JOY または Google Drive の共有 URL を貼ってください）",
          },
          { headers: CACHE_HEADERS },
        );
      }
      const text = await fetchPdfText(normalizeDriveUrl(programUrl));
      const candidates = text ? extractVenueToStartCandidates(text) : [];
      return respondCandidates(candidates, "指定URL");
    }

    // --- programUrl 未指定: 発行書類をキーワード優先順で走査 ---
    const joeUrl = resolveJoeUrl(event);
    if (!joeUrl) {
      return NextResponse.json(
        { candidates: [], message: NO_HIT_MESSAGE },
        { headers: CACHE_HEADERS },
      );
    }

    const documents: JoeDocument[] = await scrapeDocuments(joeUrl);
    const targets = sortByKeyword(documents.filter((d) => matchesKeyword(d.title)));

    for (const doc of targets) {
      const url = normalizeDriveUrl(doc.url);
      if (!isAllowedProgramUrl(url)) continue;
      const text = await fetchPdfText(url);
      if (!text) continue;
      const candidates = extractVenueToStartCandidates(text);
      if (candidates.length > 0) return respondCandidates(candidates, doc.title);
    }

    return NextResponse.json(
      { candidates: [], message: NO_HIT_MESSAGE },
      { headers: CACHE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { candidates: [], message: NO_HIT_MESSAGE },
      { headers: CACHE_HEADERS },
    );
  }
}

/** 候補（純粋関数の出力）を API 形に整形して 200 で返す。 */
function respondCandidates(
  candidates: VenueToStartCandidate[],
  source: string,
): NextResponse {
  const out: SuggestCandidate[] = candidates
    .slice(0, MAX_CANDIDATES)
    .map((c) => ({ minutes: c.minutes, context: c.context, source }));
  if (out.length === 0) {
    return NextResponse.json(
      { candidates: [], message: NO_HIT_MESSAGE },
      { headers: CACHE_HEADERS },
    );
  }
  return NextResponse.json({ candidates: out }, { headers: CACHE_HEADERS });
}

/** タイトルが対象キーワードのいずれかを含むか（大小無視）。 */
function matchesKeyword(title: string): boolean {
  const lower = title.toLowerCase();
  return DOC_TITLE_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
}

/** DOC_TITLE_KEYWORDS の並び順（プログラム優先）でソートする。 */
function sortByKeyword(docs: JoeDocument[]): JoeDocument[] {
  const rank = (title: string): number => {
    const lower = title.toLowerCase();
    const idx = DOC_TITLE_KEYWORDS.findIndex((k) => lower.includes(k.toLowerCase()));
    return idx === -1 ? DOC_TITLE_KEYWORDS.length : idx;
  };
  return [...docs].sort((a, b) => rank(a.title) - rank(b.title));
}

/**
 * PDF URL を取得して全ページ結合の plain text を返す。
 *
 * - 80MB 上限（Content-Length 先読み + ストリーム超過検知で中断）。
 * - 非PDF応答（Drive のスキャン中間 HTML 等）は content-type / マジックバイトで弾く。
 * - 取得失敗・超過・解析失敗・非PDF はすべて null（呼び出し側で次の書類へ / 候補0扱い）。
 *   ＝ throw しない（ルートの catch に頼らずグレースフルに握る）。
 */
async function fetchPdfText(url: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "trails.jp/1.0 (carpool venue-to-start)" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_BUDGET_MS),
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  // 非PDF（Drive のウイルススキャン中間ページ等の HTML）は早期に弾く。
  const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
  if (ctype.includes("text/html")) return null;

  const lenHeader = res.headers.get("content-length");
  if (lenHeader) {
    const len = Number(lenHeader);
    if (Number.isFinite(len) && len > PDF_MAX_BYTES) return null;
  }

  const data = await readWithLimit(res);
  if (!data) return null;

  // マジックバイト "%PDF" を確認（content-type 詐称・拡張子なし URL 対策）。
  if (!startsWithPdfMagic(data)) return null;

  try {
    const pdf = await getDocumentProxy(data);
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  } catch {
    return null;
  }
}

/** ストリームで読みつつ PDF_MAX_BYTES 超過を検知して中断。超過・失敗は null。 */
async function readWithLimit(res: Response): Promise<Uint8Array | null> {
  if (!res.body) {
    try {
      const buf = new Uint8Array(await res.arrayBuffer());
      return buf.byteLength > PDF_MAX_BYTES ? null : buf;
    } catch {
      return null;
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
          return null;
        }
        chunks.push(value);
      }
    }
  } catch {
    return null;
  }

  const data = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.byteLength;
  }
  return data;
}

/** 先頭が "%PDF" マジックバイトか。 */
function startsWithPdfMagic(data: Uint8Array): boolean {
  return (
    data.length >= 4 &&
    data[0] === 0x25 && // %
    data[1] === 0x50 && // P
    data[2] === 0x44 && // D
    data[3] === 0x46 //   F
  );
}

/** event 行から JOY 大会ページ URL を導出。documents/route.ts と同じ規約。 */
function resolveJoeUrl(event: Record<string, unknown>): string | null {
  const joeEventId = event.joe_event_id;
  if (joeEventId !== null && joeEventId !== undefined) {
    return `${JOE_BASE_URL}/event/view/${joeEventId}`;
  }
  const joeUrl = event.joe_url;
  if (typeof joeUrl === "string" && joeUrl.length > 0) return joeUrl;
  return null;
}
