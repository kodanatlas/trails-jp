/**
 * ジオコーディング（C: 緯度経度の自動取得）の純粋ロジック + 国土地理院 AddressSearch I/O。
 *
 * 国土地理院 住所検索 API（キー不要・利用規約に配慮した最小利用）:
 *   https://msearch.gsi.go.jp/address-search/AddressSearch?q=<名称>
 * レスポンスは GeoJSON FeatureCollection 風の配列で、各 feature の
 *   geometry.coordinates = [lng, lat]（経度・緯度の順）を持つ。
 *
 * 設計方針:
 * - 純粋ロジック（クエリ正規化・候補抽出）と I/O（fetch）を分離し、前者を vitest 対象にする。
 * - 先頭候補のみ採用。取得失敗・候補ゼロは null を返し、従来動作（座標 null のまま）を保つ。
 * - 外部呼び出しは server route 経由・タイムアウト/失敗隔離・User-Agent 明示。
 */

/** GSI AddressSearch のベース URL（クエリ q は呼び出し側で付与）。 */
export const GSI_ADDRESS_SEARCH_URL =
  "https://msearch.gsi.go.jp/address-search/AddressSearch";

/** 外部 API 呼び出しの既定タイムアウト（ミリ秒）。 */
export const GEOCODE_TIMEOUT_MS = 8000;

/** 取得結果の緯度経度。 */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * GSI AddressSearch の feature 形（必要な部分のみ）。
 * properties.title に正規化された住所/名称、geometry.coordinates に [lng, lat]。
 */
export interface GsiFeature {
  geometry?: { coordinates?: unknown } | null;
  properties?: { title?: unknown } | null;
}

/**
 * 名称クエリの正規化（命中率を上げる）。
 *
 * - 前後空白の除去と全角空白→半角化。
 * - 連続空白の単一化。
 * - 「駅」サフィックスの付与: 末尾が「駅」「IC」「インターチェンジ」「公園」「会館」
 *   等の地物語でなく、かつ短い地名（鉄道駅っぽい）の場合に「駅」を補う、ことはしない
 *   （誤補正を避ける）。代わりに呼び出し側が withStationSuffix で明示的に駅候補も試せる。
 */
export function normalizeGeocodeQuery(raw: string): string {
  return (raw ?? "")
    .replace(/　/g, " ") // 全角空白→半角
    .trim()
    .replace(/\s+/g, " ");
}

/** 末尾が地物サフィックス（駅・IC 等）で終わっているか。 */
const PLACE_SUFFIX_RE =
  /(駅|IC|インター(チェンジ)?|公園|会館|体育館|小学校|中学校|高校|高等学校|大学|役場|市役所|区役所|町役場|村役場|センター|球場|競技場|グラウンド|グランド)$/;

/**
 * 「駅」サフィックスを付与した別クエリを返す（既に地物サフィックスがあれば null）。
 *
 * 例: "八王子" → "八王子駅"。"八王子駅" → null（既に駅）。"○○公園" → null。
 * 鉄道駅の命中率を上げるための補助クエリ生成。空文字は null。
 */
export function withStationSuffix(query: string): string | null {
  const q = normalizeGeocodeQuery(query);
  if (!q) return null;
  if (PLACE_SUFFIX_RE.test(q)) return null;
  return `${q}駅`;
}

/**
 * 正規化クエリと駅サフィックス補助クエリを、試行順に並べた配列を返す。
 * 重複は除く。先頭から順に GSI へ問い合わせ、最初に命中したものを採用する想定。
 */
export function buildGeocodeQueries(raw: string): string[] {
  const base = normalizeGeocodeQuery(raw);
  if (!base) return [];
  const station = withStationSuffix(base);
  const out = [base];
  if (station && station !== base) out.push(station);
  return out;
}

/** 数値として有効な緯度（-90..90）か。 */
function isValidLat(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= -90 && n <= 90;
}

/** 数値として有効な経度（-180..180）か。 */
function isValidLng(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= -180 && n <= 180;
}

/**
 * GSI レスポンス（feature 配列）の先頭候補から LatLng を取り出す純粋関数。
 *
 * GSI の coordinates は [lng, lat] の順である点に注意。
 * - 配列でない / 空 / 座標が範囲外・非数値 なら null。
 * - 先頭候補のみ採用（複数候補のランキングはしない＝GSI の返却順を信頼）。
 */
export function pickFirstLatLng(features: unknown): LatLng | null {
  if (!Array.isArray(features) || features.length === 0) return null;
  for (const f of features as GsiFeature[]) {
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lng = coords[0];
    const lat = coords[1];
    if (isValidLat(lat) && isValidLng(lng)) {
      return { lat, lng };
    }
  }
  return null;
}

/** geocodeAddress の依存（テスト時に差し替え可能な fetch 形）。 */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * 名称 → LatLng を国土地理院 AddressSearch で解決する I/O 関数。
 *
 * - buildGeocodeQueries で 正規化クエリ → 駅サフィックス の順に試す。
 * - 最初に有効な座標が取れたものを採用。すべて失敗・タイムアウト・例外は null。
 * - User-Agent を明示。AbortController でタイムアウト。失敗は隔離して null を返す
 *   （= 従来動作: 座標 null のまま）。
 */
export async function geocodeAddress(
  raw: string,
  opts?: { fetchImpl?: FetchLike; timeoutMs?: number; signal?: AbortSignal },
): Promise<LatLng | null> {
  const queries = buildGeocodeQueries(raw);
  if (queries.length === 0) return null;

  const fetchImpl = (opts?.fetchImpl ?? (globalThis.fetch as unknown)) as FetchLike;
  const timeoutMs = opts?.timeoutMs ?? GEOCODE_TIMEOUT_MS;

  for (const q of queries) {
    const url = `${GSI_ADDRESS_SEARCH_URL}?q=${encodeURIComponent(q)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // 親 signal が中断したら子も中断。
    const onAbort = () => controller.abort();
    opts?.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await fetchImpl(url, {
        headers: { "User-Agent": "trails.jp/1.0 (carpool geocode; +https://trails.jp)" },
        signal: controller.signal,
      });
      if (!res.ok) continue;
      const json = await res.json();
      const hit = pickFirstLatLng(json);
      if (hit) return hit;
    } catch {
      // タイムアウト/ネットワーク失敗は隔離し、次のクエリ or null へ。
    } finally {
      clearTimeout(timer);
      opts?.signal?.removeEventListener("abort", onAbort);
    }
  }
  return null;
}
