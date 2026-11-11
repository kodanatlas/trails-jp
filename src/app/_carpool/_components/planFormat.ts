/**
 * プラン/結果ページ共通の純粋ヘルパ（新規・自作。既存共有ファイルには触れない）。
 * 時刻フォーマット・Google Maps ナビリンク生成など、副作用のない変換のみ。
 */

import type { NodeDTO } from "@/lib/carpool/api/mappers";

/** 0時からの分 → "H:MM"（負値・24h 跨ぎは素直に表示。NaN/null は "—"）。 */
export function minToTime(min: number | null | undefined): string {
  if (min === null || min === undefined || Number.isNaN(min)) return "—";
  const m = Math.round(min);
  const sign = m < 0 ? "-" : "";
  const abs = Math.abs(m);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  return `${sign}${hh}:${String(mm).padStart(2, "0")}`;
}

/** "HH:MM[:SS]" → "H:MM"（先頭ゼロを落とす）。不正は元の文字列、null は "—"。 */
export function trimTime(t: string | null | undefined): string {
  if (!t) return "—";
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  return `${Number(m[1])}:${m[2]}`;
}

/** 分（duration）を "N分" / "H時間M分" に整形。null は "—"。 */
export function minToDuration(min: number | null | undefined): string {
  if (min === null || min === undefined || Number.isNaN(min)) return "—";
  const m = Math.round(min);
  if (m < 60) return `${m}分`;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${hh}時間` : `${hh}時間${mm}分`;
}

/** "HH:MM[:SS]" → 0時からの分。不正・null は null。 */
export function parseHHMM(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

/**
 * 到着バッファの内訳説明文を組み立てる（純粋・配車割 Phase 4 追補）。
 *
 * 「会場 HH:MM 着 ＝ 最早スタート HH:MM の 準備60分＋スタートまでN分（計M分）前」。
 * walk（venueToStartMin）が null のときは「準備60分前（会場→スタート未設定）」に縮約する。
 * 「N分」は徒歩・大会バス両対応の意味で中立に表現する（徒歩限定にしない）。
 *
 * @param arrivalMin 会場到着（0時からの分）。null なら null（表示しない）。
 * @param earliestStartMin 最早スタート（0時からの分）。null なら null。
 * @param prepMin 準備時間（分）。
 * @param venueToStartMin 会場→スタート所要時間（分）。null=未設定。
 */
export function buildArrivalBreakdown(params: {
  arrivalMin: number | null;
  earliestStartMin: number | null;
  prepMin: number;
  venueToStartMin: number | null;
}): string | null {
  const { arrivalMin, earliestStartMin, prepMin, venueToStartMin } = params;
  if (arrivalMin === null && earliestStartMin === null) return null;

  const arr = arrivalMin !== null ? minToTime(arrivalMin) : "—";
  const start = earliestStartMin !== null ? minToTime(earliestStartMin) : "—";

  if (venueToStartMin === null) {
    return `会場 ${arr} 着 ＝ 最早スタート ${start} の 準備${prepMin}分前（会場→スタート未設定）`;
  }
  const total = prepMin + venueToStartMin;
  return `会場 ${arr} 着 ＝ 最早スタート ${start} の 準備${prepMin}分＋スタートまで${venueToStartMin}分（計${total}分）前`;
}

/**
 * Google Maps ナビリンク（04 §5）。
 * destination は会場ノードに座標があれば "lat,lng" を優先、無ければ名称。
 * origin / waypoints はノード名称（座標があれば座標）。空要素は除外。
 */
export function buildMapsDirUrl(params: {
  origin: NodeDTO | null;
  destination: NodeDTO | null;
  waypoints: NodeDTO[];
}): string | null {
  const { origin, destination, waypoints } = params;
  if (!destination) return null;

  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");

  const coordOrName = (n: NodeDTO): string =>
    n.lat !== null && n.lng !== null ? `${n.lat},${n.lng}` : n.name;

  if (origin) url.searchParams.set("origin", coordOrName(origin));
  url.searchParams.set("destination", coordOrName(destination));

  const wp = waypoints.filter(Boolean).map(coordOrName);
  if (wp.length > 0) url.searchParams.set("waypoints", wp.join("|"));

  url.searchParams.set("travelmode", "driving");
  return url.toString();
}
