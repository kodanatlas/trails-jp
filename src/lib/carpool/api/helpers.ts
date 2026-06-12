/**
 * 配車割 API 層の共通ヘルパー。
 *
 * 提供するもの:
 *   - ip_hash 生成（sha256(ip + salt)。日付ローテーションなし — hashIp の docstring 参照）
 *   - change_log 書込み（全 write の監査記録）
 *   - レート制限（change_log を ip_hash で直近1時間 COUNT、上限超過で 429）
 *   - 共通エラーレスポンス（{ error: string }・日本語）
 *   - slug → club_id 解決（全クエリで club_id を必ず絞るための共通点）
 *   - クラブ所有権検証 assertOwnedByClub（B1: body 内参照 UUID のクラブ跨ぎ防止）
 *   - 認可フック（認証なし運用。将来ここにセッション検査を1つ挿せば全ルートへ波及）
 */

import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_WRITES } from "./constants";
import { isJapanDomain, centroidLatLng, type LatLng } from "@/lib/carpool/geocode";

/**
 * ハッシュ用ソルト。likes と共用（LIKE_SALT）。
 * 注意: 環境変数欠如時のフォールバック "trails_jp" は公知文字列であり、
 * その場合 ip_hash はレインボー的逆引きに弱い。本番では LIKE_SALT 設定を前提とする。
 */
const SALT = process.env.LIKE_SALT ?? "trails_jp";

// ---------------------------------------------------------------------------
// ip_hash（sha256(ip + salt)）
// ---------------------------------------------------------------------------

/** リクエストから IP を抽出（x-forwarded-for 先頭）。取得不能時は "unknown"。 */
export function extractIp(req: NextRequest | Request): string {
  const xff =
    "headers" in req ? req.headers.get("x-forwarded-for") : null;
  return xff?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * IP のハッシュ。likes と異なり**日付ローテーションは入れない**:
 * レート制限は「直近1時間の COUNT」で行うため、日付を混ぜると UTC 日界をまたいだ
 * 瞬間にハッシュが変わり、窓内のカウントがリセットされて制限が無効化されるため。
 */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`${ip}${SALT}`).digest("hex");
}

// ---------------------------------------------------------------------------
// エラーレスポンス（{ error: string } 形式・日本語）
// ---------------------------------------------------------------------------

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export const ERR = {
  invalidBody: () => jsonError("リクエストの内容が不正です", 400),
  notFound: (what = "対象") => jsonError(`${what}が見つかりません`, 404),
  rateLimited: () =>
    jsonError("操作が多すぎます。しばらく待ってから再試行してください", 429),
  serverError: (detail?: string) =>
    jsonError(detail ? `サーバーエラー: ${detail}` : "サーバーエラーが発生しました", 500),
  conflict: (message = "競合が発生しました") => jsonError(message, 409),
} as const;

/** zod の flatten 結果から最初のメッセージを拾って 400 を返す。 */
export function zodError(issues: { message: string }[]): NextResponse {
  const first = issues[0]?.message ?? "入力値が不正です";
  return jsonError(first, 400);
}

// ---------------------------------------------------------------------------
// レート制限（純粋判定 + DB COUNT）
// ---------------------------------------------------------------------------

/**
 * 純粋関数: 直近窓内の書き込み件数から「制限超過か」を判定する。
 * count が上限「を超えた」ら true（== 上限は許可）。テスト対象。
 */
export function isRateLimited(count: number, max: number = RATE_LIMIT_MAX_WRITES): boolean {
  return count > max;
}

/**
 * change_log を ip_hash で直近 RATE_LIMIT_WINDOW_MS 件数 COUNT し、超過なら true。
 * Supabase 未設定・エラー時は false（=制限しない。書込み自体が別途失敗する）。
 */
export async function checkRateLimit(ipHash: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error } = await supabaseAdmin
    .from("carpool_change_log")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  if (error || count === null || count === undefined) return false;
  return isRateLimited(count);
}

// ---------------------------------------------------------------------------
// change_log 書込み
// ---------------------------------------------------------------------------

export interface ChangeLogEntry {
  clubId: string | null;
  tableName: string;
  recordId: string | null;
  action: "insert" | "update" | "delete";
  payload: unknown;
  actorName: string;
  ipHash: string | null;
}

/** 監査ログを1行記録する。失敗しても本処理は止めない（ベストエフォート）。 */
export async function writeChangeLog(entry: ChangeLogEntry): Promise<void> {
  const { error } = await supabaseAdmin.from("carpool_change_log").insert({
    club_id: entry.clubId,
    table_name: entry.tableName,
    record_id: entry.recordId,
    action: entry.action,
    payload: entry.payload ?? null,
    actor_name: entry.actorName,
    ip_hash: entry.ipHash,
  });
  if (error) {
    console.error("carpool change_log write failed:", error.message);
  }
}

// ---------------------------------------------------------------------------
// slug → club 解決（club_id でのスコープ漏れ防止の共通点）
// ---------------------------------------------------------------------------

export interface CarpoolClub {
  id: string;
  name: string;
  slug: string;
  joe_club_names: string[];
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** slug からクラブ行を取得。無ければ null。 */
export async function resolveClub(slug: string): Promise<CarpoolClub | null> {
  const { data, error } = await supabaseAdmin
    .from("carpool_clubs")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return data as CarpoolClub;
}

// ---------------------------------------------------------------------------
// ジオコーディングの参照点解決（同名異地の誤選択を防ぐ近傍ヒント）
// ---------------------------------------------------------------------------

/**
 * クラブのジオコーディング参照点を解決する。geocodeAddress に渡し、
 * 同名異地（例: "目黒駅" ↔ 北海道目黒）から最近傍候補を選ばせるためのヒント。
 *
 * 参照点の優先順位:
 *   ① クラブの既存ジオコーディング済みノード（日本ドメイン内）の重心
 *      （② 会場ノードも座標があれば①の集合に含まれるため別扱い不要）
 *   ③ ここで未解決（null）なら、呼び出し側で geocodeAddress が東京駅へフォールバックする。
 *
 * - lat/lng が両方 not-null のノードのみ対象。opts.excludeNodeId は集合から除外する
 *   （再ジオコーディング対象のノード自身が遠地の誤座標を持つ場合、それで重心を引っ張られない）。
 * - isJapanDomain を通らない座標（国外ゴミ）は除外。
 * - クエリエラー時は null（geocode は東京駅へフォールバック。書き込み経路は決して壊さない）。
 */
export async function resolveClubGeoRef(
  clubId: string,
  opts?: { excludeNodeId?: string },
): Promise<LatLng | null> {
  const { data, error } = await supabaseAdmin
    .from("carpool_nodes")
    .select("id, lat, lng")
    .eq("club_id", clubId)
    .not("lat", "is", null)
    .not("lng", "is", null);
  if (error || !data) return null;

  const points: LatLng[] = [];
  for (const row of data) {
    if (opts?.excludeNodeId && row.id === opts.excludeNodeId) continue;
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!isJapanDomain(lat, lng)) continue;
    points.push({ lat, lng });
  }
  return centroidLatLng(points);
}

// ---------------------------------------------------------------------------
// クラブ所有権検証（B1: クラブ跨ぎの書き込み防止）
// ---------------------------------------------------------------------------

/** 所有権検証の対象参照。値は body 中の参照 UUID（null/undefined は無視）。 */
export interface OwnershipRefs {
  nodes?: ReadonlyArray<string | null | undefined>;
  members?: ReadonlyArray<string | null | undefined>;
  events?: ReadonlyArray<string | null | undefined>;
  routes?: ReadonlyArray<string | null | undefined>;
}

const OWNERSHIP_TABLES: Record<keyof OwnershipRefs, string> = {
  nodes: "carpool_nodes",
  members: "carpool_members",
  events: "carpool_events",
  routes: "carpool_routes",
};

/** 純粋判定: 要求した id 数と club_id 一致で見つかった行数が一致しなければ違反。テスト対象。 */
export function hasOwnershipViolation(requestedCount: number, foundCount: number): boolean {
  return foundCount !== requestedCount;
}

/**
 * body 内の参照 UUID 群が、すべて当該クラブに属する行かを IN 句の件数照合で検証する。
 * 1つでも他クラブ/存在しない id があれば 404 を返す（情報漏えい防止のため存在有無は区別しない）。
 *
 * 全 write ハンドラは body の参照 UUID をここに通すこと（zod は形式しか見ない）。
 *
 * @returns 違反/エラー時は NextResponse、問題なければ null。
 */
export async function assertOwnedByClub(
  clubId: string,
  refs: OwnershipRefs,
): Promise<NextResponse | null> {
  for (const key of Object.keys(OWNERSHIP_TABLES) as Array<keyof OwnershipRefs>) {
    const raw = refs[key];
    if (!raw) continue;
    const ids = [...new Set(raw.filter((v): v is string => typeof v === "string" && v.length > 0))];
    if (ids.length === 0) continue;

    const { data, error } = await supabaseAdmin
      .from(OWNERSHIP_TABLES[key])
      .select("id")
      .in("id", ids)
      .eq("club_id", clubId);
    if (error) return ERR.serverError(error.message);
    if (hasOwnershipViolation(ids.length, (data ?? []).length)) {
      return jsonError("指定されたデータはこのクラブに属していません", 404);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// travel-times バッチの重複排除（純粋関数）
// ---------------------------------------------------------------------------

/**
 * 同一 (fromNodeId, toNodeId, mode) がバッチ内に複数ある場合に後勝ちで1件化する。
 * Postgres の upsert は同一バッチ内の重複キーでエラーになるため事前に潰す。テスト対象。
 */
export function dedupeTravelTimeEntries<
  T extends { fromNodeId: string; toNodeId: string; mode: string },
>(entries: ReadonlyArray<T>): T[] {
  const map = new Map<string, T>();
  for (const e of entries) {
    map.set(`${e.fromNodeId}>${e.toNodeId}>${e.mode}`, e);
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// 認可フック（認証なし運用 / 将来差し替え点）
// ---------------------------------------------------------------------------

/**
 * 全 write ハンドラ冒頭で通す認可フック。
 * 現在は認証なし運用のため常に許可。将来 Supabase Auth を入れる場合は
 * ここにセッション検査を追加すれば全ルートに一括適用される。
 *
 * @returns 拒否時は NextResponse、許可時は null。
 */
export async function authorizeWrite(
  _req: NextRequest | Request,
  _club: CarpoolClub | null,
): Promise<NextResponse | null> {
  return null;
}

// ---------------------------------------------------------------------------
// write ガード（rate limit + authorize をまとめて通す）
// ---------------------------------------------------------------------------

export interface WriteContext {
  ipHash: string;
  actorName: string;
}

/**
 * write 系ハンドラの共通前処理。
 * authorize → rate limit を順に通し、拒否なら NextResponse を、許可なら ctx を返す。
 */
export async function guardWrite(
  req: NextRequest | Request,
  club: CarpoolClub | null,
  actorName: string,
): Promise<{ ctx: WriteContext } | { response: NextResponse }> {
  const denied = await authorizeWrite(req, club);
  if (denied) return { response: denied };

  const ipHash = hashIp(extractIp(req));
  if (await checkRateLimit(ipHash)) {
    return { response: ERR.rateLimited() };
  }
  return { ctx: { ipHash, actorName } };
}
