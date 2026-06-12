/**
 * 移動時間の自動取得（D）の純粋ロジック + OSRM demo server I/O。
 *
 * OSRM demo server（キー不要・利用規約に配慮した最小利用）の table API:
 *   https://router.project-osrm.org/table/v1/driving/{lng,lat;lng,lat;...}?annotations=duration
 * レスポンス: { code: "Ok", durations: number[][] }（秒・i→j のマトリクス）。
 *
 * 設計方針:
 * - 純粋ロジック（座標列の組み立て・秒→分変換・未入力ペア抽出・transit 推定）と
 *   I/O（fetch）を分離し、前者を vitest 対象にする（外部 API はモック）。
 * - manual（手入力）は絶対に上書きしない。未入力ペアのみ source='osrm'/'api' で埋める。
 * - demo サーバ配慮: バッチ1回・既存値スキップ・User-Agent 明示・失敗時は呼び出し側で
 *   日本語案内へフォールバック。
 */

import { normalizeJapanLatLng } from "./geocode";

/** 座標を持つノード（自動計算の対象）。 */
export interface GeoNode {
  id: string;
  lat: number;
  lng: number;
}

/**
 * car（OSRM）所要の正気範囲の上限（分）。
 * これを超える値は座標エラー由来の異常値とみなし、保存しない（10時間相当）。
 */
export const CAR_MAX_SANE_MIN = 600;

/**
 * transit（haversine 推定）所要の正気範囲の上限（分）。
 * これを超える値は座標エラー由来の異常値とみなし、保存しない（8時間相当）。
 */
export const TRANSIT_MAX_SANE_MIN = 480;

/** 既存 travel_time（上書き判定に使う最小形）。 */
export interface ExistingTravelTime {
  fromNodeId: string;
  toNodeId: string;
  mode: "car" | "transit";
  /** 既存行の source。'manual' は保護対象。 */
  source: "manual" | "osrm" | "api";
}

/** 自動投入する travel_time エントリ（travelTimesPutSchema の entries 互換）。 */
export interface TravelTimeUpsert {
  fromNodeId: string;
  toNodeId: string;
  mode: "car" | "transit";
  minutes: number;
  source: "manual" | "osrm" | "api";
}

export const OSRM_TABLE_BASE = "https://router.project-osrm.org/table/v1/driving/";

/** 外部 API 呼び出しの既定タイムアウト（ミリ秒）。 */
export const OSRM_TIMEOUT_MS = 12000;

/** 地球半径（km）。 */
const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * 2 点間の大圏距離（km）。transit 推定と OSRM フォールバックの基礎。
 */
export function haversineKm(a: GeoNode, b: GeoNode): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 公共交通（transit）の所要分を haversine 距離から推定する単純則。
 *
 * 直線距離を「実距離≒直線×1.3」に補正し、徒歩+乗換係数として平均 ~4km/h 相当で割る
 * （駅探索・待ち時間・乗換を均した粗い実効速度）。最低 5 分・整数分・上限 cap。
 * source='api' として保存し、編集可とする（あくまで初期値の目安）。
 *
 * maxMinutes の既定は TRANSIT_MAX_SANE_MIN（480 分 = 8 時間）。座標エラーで
 * 巨大距離になった場合でも、この cap までに抑える（異常値の連鎖を防ぐ）。
 */
export function estimateTransitMinutes(
  a: GeoNode,
  b: GeoNode,
  opts?: { effectiveKmh?: number; detourFactor?: number; minMinutes?: number; maxMinutes?: number },
): number {
  const kmh = opts?.effectiveKmh ?? 4; // 徒歩+乗換を均した実効速度
  const detour = opts?.detourFactor ?? 1.3;
  const minMin = opts?.minMinutes ?? 5;
  const maxMin = opts?.maxMinutes ?? TRANSIT_MAX_SANE_MIN;
  const km = haversineKm(a, b) * detour;
  const minutes = Math.round((km / kmh) * 60);
  return Math.min(maxMin, Math.max(minMin, minutes));
}

/**
 * GeoNode 集合を日本ドメインで検疫する。
 *
 * - 各ノードの (lat,lng) を normalizeJapanLatLng に通す。
 *   - 日本ドメイン内 → そのまま ok[] へ。
 *   - swap された対（DB に [lat,lng] が逆保存された履歴データ）→ 補正した座標で ok[] へ。
 *   - 国外ドメイン（ゴミ）→ 元のノードを dropped[] へ。
 *
 * OSRM / haversine 計算前にこれで弾くことで、国外座標による異常な所要時間
 * （地球の裏側まで数千分）が DB に保存されるのを防ぐ。
 */
export function sanitizeGeoNodes(nodes: ReadonlyArray<GeoNode>): {
  ok: GeoNode[];
  dropped: GeoNode[];
} {
  const ok: GeoNode[] = [];
  const dropped: GeoNode[] = [];
  for (const n of nodes) {
    const normalized = normalizeJapanLatLng(n.lat, n.lng);
    if (normalized) {
      ok.push({ id: n.id, lat: normalized.lat, lng: normalized.lng });
    } else {
      dropped.push(n);
    }
  }
  return { ok, dropped };
}

/**
 * OSRM table API のクエリ用座標文字列を組み立てる。
 * 形式は「lng,lat;lng,lat;...」（OSRM は lon,lat 順）。
 * ノードの並び順（index）はレスポンス durations のインデックスと一致する。
 */
export function buildOsrmCoordsParam(nodes: ReadonlyArray<GeoNode>): string {
  return nodes.map((n) => `${n.lng},${n.lat}`).join(";");
}

/** OSRM table API の URL を組み立てる（annotations=duration）。 */
export function buildOsrmTableUrl(nodes: ReadonlyArray<GeoNode>): string {
  return `${OSRM_TABLE_BASE}${buildOsrmCoordsParam(nodes)}?annotations=duration`;
}

/** OSRM table レスポンスの最小形。 */
export interface OsrmTableResponse {
  code?: unknown;
  durations?: unknown;
}

/**
 * OSRM durations マトリクス（秒・[i][j]）を、ノード index ペア → 分 のリストへ変換する純粋関数。
 *
 * - 対角（i==j）は除外。
 * - null/非数値の所要は除外（OSRM が経路を見つけられなかったペア）。
 * - 秒→分は四捨五入。0 分は 1 分に底上げ（隣接ノードでも 0 分は避ける）。
 * - code が "Ok" でない、durations が行列でない場合は空配列。
 */
export function parseOsrmDurations(
  resp: OsrmTableResponse,
): Array<{ fromIndex: number; toIndex: number; minutes: number }> {
  if (resp?.code !== "Ok") return [];
  const durations = resp.durations;
  if (!Array.isArray(durations)) return [];
  const out: Array<{ fromIndex: number; toIndex: number; minutes: number }> = [];
  for (let i = 0; i < durations.length; i++) {
    const row = durations[i];
    if (!Array.isArray(row)) continue;
    for (let j = 0; j < row.length; j++) {
      if (i === j) continue;
      const sec = row[j];
      if (typeof sec !== "number" || !Number.isFinite(sec)) continue;
      const minutes = Math.max(1, Math.round(sec / 60));
      out.push({ fromIndex: i, toIndex: j, minutes });
    }
  }
  return out;
}

/** (from,to,mode) の合成キー。 */
function pairKey(fromNodeId: string, toNodeId: string, mode: string): string {
  return `${fromNodeId}>${toNodeId}>${mode}`;
}

/**
 * 既存 travel_times のうち「上書きしてはいけないキー集合」を返す。
 *
 * 既定では **すべての既存値**（manual / osrm / api いずれも）を保護＝未入力ペアのみ埋める。
 * （手入力 manual を守るのは必須要件。osrm/api 済みも再計算で無駄に上書きしない＝キャッシュ。）
 */
export function buildSkipKeySet(
  existing: ReadonlyArray<ExistingTravelTime>,
): Set<string> {
  const s = new Set<string>();
  for (const e of existing) {
    s.add(pairKey(e.fromNodeId, e.toNodeId, e.mode));
  }
  return s;
}

/**
 * 座標を持つノード集合 + OSRM durations + 既存値 から、
 * 「未入力の car ペアのみ」を source='osrm' で埋める upsert リストを組み立てる純粋関数。
 *
 * - nodes の index は parseOsrmDurations の fromIndex/toIndex に対応している前提。
 * - 既存（skip 集合）に含まれるペアは除外（manual を含む全 source を保護）。
 */
export function buildCarUpserts(
  nodes: ReadonlyArray<GeoNode>,
  durations: ReadonlyArray<{ fromIndex: number; toIndex: number; minutes: number }>,
  skip: Set<string>,
): TravelTimeUpsert[] {
  const out: TravelTimeUpsert[] = [];
  for (const d of durations) {
    const from = nodes[d.fromIndex];
    const to = nodes[d.toIndex];
    if (!from || !to) continue;
    // 座標エラー由来の異常値（10時間超）は保存しない。
    if (d.minutes > CAR_MAX_SANE_MIN) continue;
    const key = pairKey(from.id, to.id, "car");
    if (skip.has(key)) continue;
    out.push({
      fromNodeId: from.id,
      toNodeId: to.id,
      mode: "car",
      minutes: d.minutes,
      source: "osrm",
    });
  }
  return out;
}

/**
 * 座標を持つノード集合 + 既存値 から、
 * 「未入力の transit ペアのみ」を haversine 推定（source='api'）で埋める upsert リスト。
 *
 * 全順序対（i≠j）を対象。skip 集合（manual を含む既存全 source）は除外。
 */
export function buildTransitUpserts(
  nodes: ReadonlyArray<GeoNode>,
  skip: Set<string>,
  opts?: Parameters<typeof estimateTransitMinutes>[2],
): TravelTimeUpsert[] {
  const out: TravelTimeUpsert[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const from = nodes[i];
      const to = nodes[j];
      const key = pairKey(from.id, to.id, "transit");
      if (skip.has(key)) continue;
      const minutes = estimateTransitMinutes(from, to, opts);
      // 座標エラー由来の異常値（8時間超）は保存しない。
      if (minutes > TRANSIT_MAX_SANE_MIN) continue;
      out.push({
        fromNodeId: from.id,
        toNodeId: to.id,
        mode: "transit",
        minutes,
        source: "api",
      });
    }
  }
  return out;
}

/**
 * 自動計算の全エントリ（car: OSRM + transit: 推定）を未入力ペアのみで組み立てる純粋関数。
 *
 * @param nodes 座標つきノード（index は durations と一致）
 * @param durations parseOsrmDurations の出力（OSRM 失敗時は空配列でよい）
 * @param existing 既存 travel_times
 * @returns { car, transit, all } の upsert リスト
 */
export function buildAutoUpserts(
  nodes: ReadonlyArray<GeoNode>,
  durations: ReadonlyArray<{ fromIndex: number; toIndex: number; minutes: number }>,
  existing: ReadonlyArray<ExistingTravelTime>,
  opts?: Parameters<typeof estimateTransitMinutes>[2],
): { car: TravelTimeUpsert[]; transit: TravelTimeUpsert[]; all: TravelTimeUpsert[] } {
  const skip = buildSkipKeySet(existing);
  const car = buildCarUpserts(nodes, durations, skip);
  const transit = buildTransitUpserts(nodes, skip, opts);
  return { car, transit, all: [...car, ...transit] };
}

/**
 * route_times の初期値を OSRM の「各ノード → 会場ノード」car 所要から組み立てる純粋関数。
 *
 * 会場ノードに座標がある場合、全 area/pickup ノードからの car 所要を minutesToVenue とする。
 * ルート別の差（高速/下道など）は手修正前提なので、ここでは全ルート共通の初期値を返す。
 *
 * @param nodes durations と index 整合した座標つきノード（会場含む）
 * @param venueIndex nodes 内の会場ノードの index
 * @param durations parseOsrmDurations の出力
 * @returns nodeId → minutesToVenue（会場自身は除外）
 */
export function buildRouteTimesToVenue(
  nodes: ReadonlyArray<GeoNode>,
  venueIndex: number,
  durations: ReadonlyArray<{ fromIndex: number; toIndex: number; minutes: number }>,
): Array<{ nodeId: string; minutesToVenue: number }> {
  if (venueIndex < 0 || venueIndex >= nodes.length) return [];
  const byPair = new Map<string, number>();
  for (const d of durations) {
    byPair.set(`${d.fromIndex}>${d.toIndex}`, d.minutes);
  }
  const out: Array<{ nodeId: string; minutesToVenue: number }> = [];
  for (let i = 0; i < nodes.length; i++) {
    if (i === venueIndex) continue;
    const minutes = byPair.get(`${i}>${venueIndex}`);
    if (minutes === undefined) continue;
    out.push({ nodeId: nodes[i].id, minutesToVenue: minutes });
  }
  return out;
}

/** fetchOsrmTable の依存（テスト時に差し替え可能な fetch 形）。 */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * OSRM table API を 1 回だけ叩いて durations を取得する I/O 関数。
 *
 * - 座標つきノードが 2 未満なら空配列（計算不要）。
 * - User-Agent 明示・AbortController でタイムアウト・失敗は隔離して空配列を返す
 *   （呼び出し側は空配列を「OSRM 不達 → transit 推定のみ or 日本語案内」に使う）。
 */
export async function fetchOsrmTable(
  nodes: ReadonlyArray<GeoNode>,
  opts?: { fetchImpl?: FetchLike; timeoutMs?: number; signal?: AbortSignal },
): Promise<Array<{ fromIndex: number; toIndex: number; minutes: number }>> {
  if (nodes.length < 2) return [];
  const fetchImpl = (opts?.fetchImpl ?? (globalThis.fetch as unknown)) as FetchLike;
  const timeoutMs = opts?.timeoutMs ?? OSRM_TIMEOUT_MS;
  const url = buildOsrmTableUrl(nodes);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  opts?.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": "trails.jp/1.0 (carpool travel-times; +https://trails.jp)" },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as OsrmTableResponse;
    return parseOsrmDurations(json);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener("abort", onAbort);
  }
}
