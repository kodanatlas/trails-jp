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

import { normalizeJapanLatLng, haversineKm } from "./geocode";

// haversineKm は geocode.ts へ移設済み（geocode が候補選択に必要 + 循環回避のため）。
// 従来 "../osrm" から haversineKm を import している箇所・テストのため再エクスポートする。
export { haversineKm };

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
 *
 * 注: estimateTransitMinutes はこの値でクランプしない（生値を返す）。
 * 上限超過の「保存スキップ」判定は buildTransitUpserts がこの定数で行う
 * （クランプ値 480 を DB に保存しないため）。plan-input/UI も参照しうる。
 */
export const TRANSIT_MAX_SANE_MIN = 480;

/**
 * car（OSRM）所要から transit を推定するときの係数（乗換・待ち・徒歩バッファ）。
 * car 22 分 → 約 50 分（22 * 1.6 + 15）の保守的推定。
 */
export const TRANSIT_CAR_FACTOR = 1.6;

/**
 * car（OSRM）所要から transit を推定するときの固定バッファ分（乗換・待ち・徒歩）。
 * car 22 分 → 約 50 分（22 * 1.6 + 15）の保守的推定。
 */
export const TRANSIT_CAR_BUFFER_MIN = 15;

/**
 * car（OSRM）の所要分から transit の所要分を推定する。
 *
 * 同一ペアに car 所要がある場合、都市鉄道圏では haversine 推定より遥かに実態に近い。
 * 係数 TRANSIT_CAR_FACTOR と固定バッファ TRANSIT_CAR_BUFFER_MIN で、乗換・待ち・
 * 徒歩を均した保守的な値を返す（car 22 分 → 約 50 分）。
 */
export function estimateTransitFromCarMinutes(carMinutes: number): number {
  return Math.round(carMinutes * TRANSIT_CAR_FACTOR + TRANSIT_CAR_BUFFER_MIN);
}

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

/**
 * 公共交通（transit）の所要分を haversine 距離から推定する単純則（fallback）。
 *
 * 直線距離を「実距離≒直線×1.3」に補正し、徒歩+乗換係数として平均 ~4km/h 相当で割る
 * （駅探索・待ち時間・乗換を均した粗い実効速度）。最低 5 分・整数分。
 * source='api' として保存し、編集可とする（あくまで初期値の目安）。
 *
 * car 所要があるペアではそちらを第一情報源にすべきで、本関数は car 不在時の fallback。
 * 上限クランプは廃止（生値を返す）。上限超過の扱いは buildTransitUpserts が
 * 「保存スキップ」で行う（クランプ値 480 を保存しない）。
 */
export function estimateTransitMinutes(
  a: GeoNode,
  b: GeoNode,
  opts?: { effectiveKmh?: number; detourFactor?: number; minMinutes?: number },
): number {
  const kmh = opts?.effectiveKmh ?? 4; // 徒歩+乗換を均した実効速度
  const detour = opts?.detourFactor ?? 1.3;
  const minMin = opts?.minMinutes ?? 5;
  const km = haversineKm(a, b) * detour;
  const minutes = Math.round((km / kmh) * 60);
  return Math.max(minMin, minutes);
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
 * 「未入力の transit ペアのみ」を埋める upsert リストを組み立てる純粋関数。
 *
 * 全順序対（i≠j）を対象。skip 集合（manual を含む既存全 source）は除外。
 *
 * transit の推定は次の優先順で行う:
 *   1. carMinutesByPair に同一ペアの car 所要があれば estimateTransitFromCarMinutes（第一情報源）
 *   2. なければ estimateTransitMinutes（haversine fallback）
 *
 * 推定値が TRANSIT_MAX_SANE_MIN（480）を超えるペアは「信頼できない」とみなし、
 * クランプ値を保存せずペアごと丸ごとスキップする（skippedOverCap で件数を返す）。
 *
 * @param carMinutesByPair "${fromId}>${toId}" → car 所要分（異常値は呼び出し側で除外済みの前提）
 */
export function buildTransitUpserts(
  nodes: ReadonlyArray<GeoNode>,
  skip: Set<string>,
  opts?: Parameters<typeof estimateTransitMinutes>[2],
  carMinutesByPair?: ReadonlyMap<string, number>,
): { upserts: TravelTimeUpsert[]; skippedOverCap: number } {
  const upserts: TravelTimeUpsert[] = [];
  let skippedOverCap = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const from = nodes[i];
      const to = nodes[j];
      const key = pairKey(from.id, to.id, "transit");
      if (skip.has(key)) continue;
      const carMin = carMinutesByPair?.get(`${from.id}>${to.id}`);
      const minutes =
        carMin !== undefined
          ? estimateTransitFromCarMinutes(carMin)
          : estimateTransitMinutes(from, to, opts);
      // 座標エラー由来の異常値（8時間超）はクランプ値を保存せずスキップ。
      if (minutes > TRANSIT_MAX_SANE_MIN) {
        skippedOverCap += 1;
        continue;
      }
      upserts.push({
        fromNodeId: from.id,
        toNodeId: to.id,
        mode: "transit",
        minutes,
        source: "api",
      });
    }
  }
  return { upserts, skippedOverCap };
}

/**
 * 自動計算の全エントリ（car: OSRM + transit: 推定）を未入力ペアのみで組み立てる純粋関数。
 *
 * car 計算が先で、その結果（carMinutesByPair）を transit 推定の第一情報源にする。
 * 都市鉄道圏では haversine 推定が大きく外れる（目黒→練馬 ≈248分 vs 実態 ~25分）ため、
 * 同一ペアに car 所要があればそれをベースに transit を推定する。
 *
 * carMinutesByPair は durations から組むが、異常な car 所要（CAR_MAX_SANE_MIN 超）は
 * 含めない（bug-1 防御と整合）。そうしたペアは haversine fallback に回り、なお
 * 480 を超えるなら buildTransitUpserts のスキップガードで保存対象から外れる。
 *
 * @param nodes 座標つきノード（index は durations と一致）
 * @param durations parseOsrmDurations の出力（OSRM 失敗時は空配列でよい）
 * @param existing 既存 travel_times
 * @returns { car, transit, all, transitSkippedOverCap }（transit は保存対象のみ）
 */
export function buildAutoUpserts(
  nodes: ReadonlyArray<GeoNode>,
  durations: ReadonlyArray<{ fromIndex: number; toIndex: number; minutes: number }>,
  existing: ReadonlyArray<ExistingTravelTime>,
  opts?: Parameters<typeof estimateTransitMinutes>[2],
): {
  car: TravelTimeUpsert[];
  transit: TravelTimeUpsert[];
  all: TravelTimeUpsert[];
  transitSkippedOverCap: number;
} {
  const skip = buildSkipKeySet(existing);
  const car = buildCarUpserts(nodes, durations, skip);

  // car 所要を transit 推定の第一情報源にするため "${fromId}>${toId}" → 分 へ写像。
  // 異常な car 所要（CAR_MAX_SANE_MIN 超）はベースに使わない（haversine fallback へ）。
  const carMinutesByPair = new Map<string, number>();
  for (const d of durations) {
    const from = nodes[d.fromIndex];
    const to = nodes[d.toIndex];
    if (!from || !to) continue;
    if (d.minutes > CAR_MAX_SANE_MIN) continue;
    carMinutesByPair.set(`${from.id}>${to.id}`, d.minutes);
  }

  const { upserts: transit, skippedOverCap: transitSkippedOverCap } = buildTransitUpserts(
    nodes,
    skip,
    opts,
    carMinutesByPair,
  );
  return { car, transit, all: [...car, ...transit], transitSkippedOverCap };
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
