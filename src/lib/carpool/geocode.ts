/**
 * ジオコーディング（C: 緯度経度の自動取得）の純粋ロジック + 国土地理院 AddressSearch I/O。
 *
 * 国土地理院 住所検索 API（キー不要・利用規約に配慮した最小利用）:
 *   https://msearch.gsi.go.jp/address-search/AddressSearch?q=<名称>
 * レスポンスは GeoJSON FeatureCollection 風の配列で、各 feature の
 *   geometry.coordinates = [lng, lat]（経度・緯度の順）を持つ。
 *
 * 設計方針:
 * - 純粋ロジック（クエリ正規化・候補抽出・候補選択）と I/O（fetch）を分離し、前者を vitest 対象にする。
 * - 複数候補から「参照点に最も近い候補」を採用（pickBestLatLng）。GSI は同名異地（例: 目黒駅↔
 *   北海道目黒）を返すことがあり、先頭採用だと遠地を誤選択するため。取得失敗・候補ゼロは null を
 *   返し、従来動作（座標 null のまま）を保つ。
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

// ---------------------------------------------------------------------------
// 日本ドメインの緯度経度判定（座標の swap 防御 + 国外ゴミデータの除外）
// ---------------------------------------------------------------------------

/** 日本の緯度の下限（沖縄〜与那国の南端を含む粗い矩形）。 */
export const JAPAN_LAT_MIN = 20;
/** 日本の緯度の上限（北海道北端を含む）。 */
export const JAPAN_LAT_MAX = 46;
/** 日本の経度の下限（与那国の西端を含む）。 */
export const JAPAN_LNG_MIN = 122;
/** 日本の経度の上限（南鳥島の東端を含む）。 */
export const JAPAN_LNG_MAX = 154;

/**
 * (lat, lng) が日本の粗い矩形ドメイン内か。
 * lat ∈ [20,46] かつ lng ∈ [122,154] のときだけ true。
 */
export function isJapanDomain(lat: number, lng: number): boolean {
  return (
    lat >= JAPAN_LAT_MIN &&
    lat <= JAPAN_LAT_MAX &&
    lng >= JAPAN_LNG_MIN &&
    lng <= JAPAN_LNG_MAX
  );
}

/**
 * 日本ドメイン前提で (lat, lng) を正規化する。
 *
 * - 既に日本ドメイン内ならそのまま {lat,lng} を返す。
 * - lat/lng を入れ替えると日本ドメインに入る（= DB に [lat,lng] が swap 保存された
 *   履歴データ）なら、入れ替えた {lat:lng, lng:lat} を返して自動補正する。
 * - どちらでもない（国外のゴミ）なら null を返して棄却する。
 */
export function normalizeJapanLatLng(lat: number, lng: number): LatLng | null {
  if (isJapanDomain(lat, lng)) return { lat, lng };
  if (isJapanDomain(lng, lat)) return { lat: lng, lng: lat };
  return null;
}

// ---------------------------------------------------------------------------
// 距離（haversine）と候補選択の参照点
// ---------------------------------------------------------------------------

/** 地球半径（km）。 */
const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * 2 点間の大圏距離（km）。候補選択（pickBestLatLng）と OSRM フォールバックの基礎。
 *
 * 元は osrm.ts に置いていたが、geocode が候補選択に必要としかつ osrm.ts は geocode を
 * import する（循環回避のため geocode → osrm の import は不可）ため、こちらへ移設。
 * osrm.ts は `export { haversineKm }` で再エクスポートし、従来の import 経路を維持する。
 */
export function haversineKm(a: LatLng, b: LatLng): number {
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
 * 最終フォールバックの参照点（東京駅）。
 * 呼び出し側がクラブの既存ノードから参照点を解決できなかった場合に使う。
 */
export const TOKYO_STATION: LatLng = { lat: 35.681, lng: 139.767 };

/**
 * 「近傍」とみなす距離上限（km）。駅優先の足切りに使う閾値であり、
 * **候補選択そのものの足切りには使わない**（遠征大会の会場登録を阻害しないため、
 * これを超える候補も最終的には最近傍として採用しうる）。
 */
export const GEOCODE_NEAR_KM = 300;

/**
 * 点群の算術平均（重心）を返す。空配列は null。
 * クラブの既存ジオコーディング済みノードから参照点を作るのに使う。
 */
export function centroidLatLng(points: ReadonlyArray<LatLng>): LatLng | null {
  if (points.length === 0) return null;
  let sumLat = 0;
  let sumLng = 0;
  for (const p of points) {
    sumLat += p.lat;
    sumLng += p.lng;
  }
  return { lat: sumLat / points.length, lng: sumLng / points.length };
}

/** pickBestLatLng が扱う 1 候補（正規化済み座標 + タイトル）。 */
interface GeocodeCandidate {
  lat: number;
  lng: number;
  title: string;
}

/**
 * 候補タイトルとクエリの「完全一致」判定用の正規化。
 * NFKC 統一 + 空白（半角/全角）除去。例: "目黒 駅" と "目黒駅" を同一視。
 */
export function compactForMatch(s: string): string {
  return (s ?? "").normalize("NFKC").replace(/[\s　]/g, "");
}

/**
 * GSI features から有効候補（日本ドメイン正規化済み）を抽出する内部パーサ。
 *
 * 各候補は pickFirstLatLng と同じゲートを通す:
 *   coords が配列かつ長さ >= 2 → isValidLat/isValidLng（第1ゲート）→
 *   normalizeJapanLatLng（第2ゲート: swap 補正 + 国外ゴミ棄却。null は drop）。
 * title は properties.title を文字列化（無ければ ""）。
 */
function parseGeocodeCandidates(features: unknown): GeocodeCandidate[] {
  if (!Array.isArray(features)) return [];
  const out: GeocodeCandidate[] = [];
  for (const f of features as GsiFeature[]) {
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lng = coords[0];
    const lat = coords[1];
    if (!isValidLat(lat) || !isValidLng(lng)) continue;
    const normalized = normalizeJapanLatLng(lat, lng);
    if (!normalized) continue;
    const title = String(f?.properties?.title ?? "");
    out.push({ lat: normalized.lat, lng: normalized.lng, title });
  }
  return out;
}

/**
 * pickBestCandidate の結果（採用候補の座標 + 解決先タイトル + 完全一致フラグ）。
 *
 * - title: 採用した GSI 候補の properties.title（解決先の地点名）。
 * - exact: compactForMatch(title) === compactForMatch(normalizeGeocodeQuery(query))。
 *   入力名と解決先名が（NFKC・空白無視で）完全一致したか。false は「目黒駅と入力したのに
 *   中目黒駅が採用された」のような同名近接の誤解決の可能性を示し、UI 側の確認導線に使う。
 */
export interface GeocodeResolution extends LatLng {
  title: string;
  exact: boolean;
}

/**
 * GSI レスポンス（feature 配列）から「参照点に最も近い候補」を選び、その座標・解決先タイトル・
 * 完全一致フラグを返す純粋関数。pickBestLatLng の本体であり、UI が解決先を提示するための
 * title/exact もここで決める。
 *
 * GSI は同名異地（例: クエリ "目黒駅" に対し正解の目黒駅と、北海道広尾郡大樹町字目黒）を
 * 返すことがあり、いずれも日本ドメイン内のため isJapanDomain では弾けない。先頭採用だと
 * 遠地を誤選択するため、参照点 ref への haversine 最近傍を採る。
 *
 * ロジック:
 *   1. 候補抽出（parseGeocodeCandidates）。空なら null。
 *   2. 完全一致優先: title がクエリ名と完全一致する候補があれば、それだけに絞る。
 *      これが「目黒駅」を「中目黒駅」より必ず優先する（両者とも都内の "駅" で近接しており、
 *      距離だけでは判別できず GSI が中目黒駅を上位に返すことがあるため）。
 *      完全一致が複数（同名異地）なら下の ref 最近傍で決着する。
 *   3. 駅優先: 完全一致が無く normalizeGeocodeQuery(query) が "駅" を含むとき、title が "駅" で
 *      終わる候補（stationSubset）を作る。stationSubset が非空 **かつ** その少なくとも 1 つが ref
 *      から GEOCODE_NEAR_KM(300km) 以内なら、検討対象を stationSubset に絞る。
 *      逆に駅候補がすべて 300km 超で非駅候補が存在する場合は絞らない（= 全候補で比較）。
 *      これが「目黒駅 → 北海道目黒（駅ではない）」の逆ケースを保護する。
 *   4. ref への haversine 最近傍を返す。
 *      **距離で棄却は一切しない**: すべての候補が 300km 超でも、最も近い候補を返す
 *      （遠征大会の会場登録を阻害しないため）。
 *   5. 採用候補の title と exact（入力名との完全一致）を付与して返す。
 */
export function pickBestCandidate(
  features: unknown,
  ref: LatLng,
  query: string,
): GeocodeResolution | null {
  const candidates = parseGeocodeCandidates(features);
  if (candidates.length === 0) return null;

  let pool: GeocodeCandidate[] = candidates;

  // 完全一致優先（同名近接の誤選択＝目黒駅/中目黒駅 対策）。
  // ただし駅優先と同じ近接ガードを掛ける: 完全一致候補が ref から GEOCODE_NEAR_KM 以内に
  // 1 つでもある場合のみ絞る。遠地のみの完全一致（例: 北海道の同名駅）には引きずられない。
  const nq = compactForMatch(normalizeGeocodeQuery(query));
  const exactSubset = candidates.filter((c) => compactForMatch(c.title) === nq);
  if (
    exactSubset.length > 0 &&
    exactSubset.some((c) => haversineKm({ lat: c.lat, lng: c.lng }, ref) <= GEOCODE_NEAR_KM)
  ) {
    pool = exactSubset;
  } else if (normalizeGeocodeQuery(query).includes("駅")) {
    // 駅優先（条件付き）。
    const stationSubset = candidates.filter((c) => c.title.endsWith("駅"));
    if (
      stationSubset.length > 0 &&
      stationSubset.some((c) => haversineKm({ lat: c.lat, lng: c.lng }, ref) <= GEOCODE_NEAR_KM)
    ) {
      pool = stationSubset;
    }
  }

  // ref への最近傍を選ぶ（距離による棄却はしない）。
  let best = pool[0];
  let bestDist = haversineKm({ lat: best.lat, lng: best.lng }, ref);
  for (let i = 1; i < pool.length; i++) {
    const c = pool[i];
    const d = haversineKm({ lat: c.lat, lng: c.lng }, ref);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }

  // exact は採用 title と入力名（正規化）の完全一致。比較規約は完全一致優先の絞り込み（上の nq）
  // と同じ compactForMatch（NFKC + 空白除去）に揃える。
  return {
    lat: best.lat,
    lng: best.lng,
    title: best.title,
    exact: compactForMatch(best.title) === nq,
  };
}

/**
 * pickBestCandidate の座標だけを返す後方互換ラッパ。
 * 既存の呼び出し側・回帰テスト（pickBestLatLng）は座標のみを期待するため、薄く包む。
 */
export function pickBestLatLng(features: unknown, ref: LatLng, query: string): LatLng | null {
  const r = pickBestCandidate(features, ref, query);
  return r ? { lat: r.lat, lng: r.lng } : null;
}

/**
 * GSI レスポンス（feature 配列）の先頭候補から LatLng を取り出す純粋関数。
 *
 * GSI の coordinates は [lng, lat] の順である点に注意。
 * - 配列でない / 空 / 座標が範囲外・非数値 なら null。
 * - 先頭候補のみ採用（複数候補のランキングはしない＝GSI の返却順を信頼）。
 *
 * 注: geocodeAddress は本関数ではなく pickBestLatLng（参照点最近傍）を使う。
 * 本関数は既存テストとの後方互換のため残す（複数候補からの遠地誤選択は防げない点に注意）。
 */
export function pickFirstLatLng(features: unknown): LatLng | null {
  if (!Array.isArray(features) || features.length === 0) return null;
  for (const f of features as GsiFeature[]) {
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lng = coords[0];
    const lat = coords[1];
    // 第1ゲート: 物理的に有効な緯度経度（-90..90 / -180..180）。
    if (!isValidLat(lat) || !isValidLng(lng)) continue;
    // 第2ゲート: 日本ドメイン正規化（swap 自動補正 + 国外ゴミの棄却）。
    const normalized = normalizeJapanLatLng(lat, lng);
    if (!normalized) continue; // 国外ドメインはこの候補を飛ばす
    return normalized;
  }
  return null;
}

/** geocodeAddress の依存（テスト時に差し替え可能な fetch 形）。 */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** geocodeAddress / geocodeAddressDetailed の共通オプション。 */
export interface GeocodeOpts {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  signal?: AbortSignal;
  ref?: LatLng;
}

/**
 * 名称 → 解決先（座標 + GSI title + 完全一致フラグ）を国土地理院 AddressSearch で解決する I/O 関数。
 *
 * geocodeAddress の詳細版。座標に加えて UI が「どこに解決したか」を提示するための
 * title（採用候補の GSI title）と exact（入力名と解決先名の完全一致）を返す。
 *
 * - buildGeocodeQueries で 正規化クエリ → 駅サフィックス の順に試す。
 * - 各クエリの候補から pickBestCandidate（参照点 ref への最近傍 + 完全一致/駅優先）で 1 件を採用。
 *   ref 省略時は東京駅（TOKYO_STATION）。最初に命中したものを返す。
 * - exact は **その命中を出したクエリ q** との完全一致で判定する。例: 入力 "八王子" が空振りし
 *   駅サフィックス "八王子駅" で命中した場合、exact は "八王子駅" 基準で評価される（解決先が
 *   "八王子駅" なら exact=true）。これにより「入力どおりの駅に解決できた」ケースを静かに通せる。
 * - すべて失敗・タイムアウト・例外は null。User-Agent を明示。AbortController でタイムアウト。
 *   失敗は隔離して null を返す（= 従来動作: 座標 null のまま）。
 */
export async function geocodeAddressDetailed(
  raw: string,
  opts?: GeocodeOpts,
): Promise<GeocodeResolution | null> {
  const queries = buildGeocodeQueries(raw);
  if (queries.length === 0) return null;

  const fetchImpl = (opts?.fetchImpl ?? (globalThis.fetch as unknown)) as FetchLike;
  const timeoutMs = opts?.timeoutMs ?? GEOCODE_TIMEOUT_MS;
  const ref = opts?.ref ?? TOKYO_STATION;

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
      const hit = pickBestCandidate(json, ref, q);
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

/**
 * 名称 → LatLng を国土地理院 AddressSearch で解決する I/O 関数（後方互換）。
 *
 * geocodeAddressDetailed の座標だけを返す薄いラッパ。title/exact が不要な既存呼び出しは
 * こちらをそのまま使える（戻り値・挙動は従来と不変: 失敗・候補ゼロは null）。
 */
export async function geocodeAddress(
  raw: string,
  opts?: GeocodeOpts,
): Promise<LatLng | null> {
  const r = await geocodeAddressDetailed(raw, opts);
  return r ? { lat: r.lat, lng: r.lng } : null;
}
