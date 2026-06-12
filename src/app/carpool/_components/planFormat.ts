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
