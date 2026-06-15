/**
 * 会場（venue）座標の取得方針を表す純粋ロジック。
 *
 * 背景（バグ修正の要点）:
 * - 会場ノードの座標は **JOY 大会詳細ページの Leaflet 地図ピン**（`scrapeEventCoordinates`）が正。
 * - 会場名の**ジオコーディング**（GSI AddressSearch）は曖昧で、実害として約 8km ずれる
 *   （例: 「曽根丘陵公園」が名前ジオコーディングだと 35.664,138.568 / JOY ピンは 35.5905,138.5839）。
 *   よって **kind='venue' のノードには名前ジオコーディングを一切使わない**。
 * - area/pickup（自宅駅など JOY ピンが存在しない場所）は従来どおり名前ジオコーディングを使う。
 *
 * この層は I/O を持たない純粋関数だけを置き、route 側が scrape / geocode の実 I/O を注入する。
 */

/** carpool_nodes.kind の取りうる値（このモジュールが判定に使う最小集合）。 */
export type NodeKind = "venue" | "area" | "pickup" | string;

/**
 * そのノード種別を **名前ジオコーディング** してよいか。
 *
 * - venue: false（JOY の地図ピンが正。名前は曖昧で実害があるため使わない）。
 * - それ以外（area / pickup / 未知）: true（JOY ピンが無い場所なので従来どおり名前で引く）。
 */
export function shouldGeocodeNodeKind(kind: NodeKind): boolean {
  return kind !== "venue";
}

/**
 * store（events.json / readEvents 由来）の lat/lng が「そのまま使える有効な数値座標」か。
 *
 * - 数値かつ有限のときだけ true。null / undefined / NaN / Infinity は false。
 * - 文字列等の非数値も false（events.json の型が緩い場合の防御）。
 */
export function hasUsableStoreCoords(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lng === "number" &&
    Number.isFinite(lng)
  );
}

/** 会場座標の解決結果。source は監査・テスト用に「どの経路で決まったか」を残す。 */
export interface VenueCoordResult {
  lat: number | null;
  lng: number | null;
  /** "store"=store座標採用 / "scrape"=JOYピン採用 / "none"=座標なし */
  source: "store" | "scrape" | "none";
}

/**
 * 会場座標の決定（純粋）。優先順位は **store座標 → scrape結果 → null**。
 *
 * - store の lat/lng が有効数値ならそれを採用（`scrape` は呼ばれない＝呼び出し側は scraped を渡さなくてよい）。
 * - store が無効で scraped（JOY ピン）が有効数値ならそれを採用。
 * - どちらも無ければ座標なし（後で地図ピッカーで指定する）。
 *
 * scrape の実 I/O（`scrapeEventCoordinates`）は route 側で行い、その結果（または null）を
 * `scraped` として渡す。store が有効なら scrape をそもそも呼ばないため、呼び出し側は
 * 「store が無効なときだけ scrape を await して渡す」最適化ができる。
 */
export function resolveVenueCoords(
  store: { lat: unknown; lng: unknown },
  scraped: { lat: number; lng: number } | null,
): VenueCoordResult {
  if (hasUsableStoreCoords(store.lat, store.lng)) {
    return { lat: store.lat as number, lng: store.lng as number, source: "store" };
  }
  if (scraped && hasUsableStoreCoords(scraped.lat, scraped.lng)) {
    return { lat: scraped.lat, lng: scraped.lng, source: "scrape" };
  }
  return { lat: null, lng: null, source: "none" };
}

/** resolveVenueCoordsWithScrape に注入する JOY ピン取得 I/O（events.ts の scrapeEventCoordinates 形）。 */
export type ScrapeCoordsFn = (
  joeUrl: string,
) => Promise<{ lat: number; lng: number } | null>;

/**
 * 会場座標を「store座標 → JOY地図ピンの scrape → null」の優先順位で解決する小オーケストレータ。
 *
 * events POST が venue ノードを作る際の座標決定そのもの。scrape の実 I/O を `scrape` で注入する
 * ことで、route の分岐（store が有効なら scrape を呼ばない / store が null かつ joe_url があれば
 * scrape を await する / scrape 失敗は隔離して null 扱い）を純粋にテストできる。
 *
 * - store の lat/lng が有効数値なら scrape は**呼ばない**（無駄な外部アクセスを避ける）。
 * - store が無効で joeUrl があれば scrape を await。例外は隔離して null 扱い。
 * - joeUrl が無ければ scrape しない（座標なし）。
 */
export async function resolveVenueCoordsWithScrape(
  store: { lat: unknown; lng: unknown },
  joeUrl: string | null | undefined,
  scrape: ScrapeCoordsFn,
): Promise<VenueCoordResult> {
  if (hasUsableStoreCoords(store.lat, store.lng)) {
    return { lat: store.lat as number, lng: store.lng as number, source: "store" };
  }
  let scraped: { lat: number; lng: number } | null = null;
  if (joeUrl) {
    try {
      scraped = await scrape(joeUrl);
    } catch {
      scraped = null;
    }
  }
  return resolveVenueCoords(store, scraped);
}
