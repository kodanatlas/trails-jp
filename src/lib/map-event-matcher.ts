import type { JOEEvent } from "@/lib/scraper/events";
import type { OrienteeringMap } from "@/types/map";

/**
 * 座標がO-mapのbounds内（+margin）に含まれるか判定
 * marginDeg ≈ 0.01度 ≈ 約1km
 */
export function isPointInBounds(
  lat: number,
  lng: number,
  bounds: OrienteeringMap["bounds"],
  marginDeg = 0.01
): boolean {
  return (
    lat >= bounds.south - marginDeg &&
    lat <= bounds.north + marginDeg &&
    lng >= bounds.west - marginDeg &&
    lng <= bounds.east + marginDeg
  );
}

/**
 * O-mapに紐づくJOYイベントを検索
 * イベントの座標がbounds内に含まれるものを日付降順で返す
 */
export function findEventsForMap(
  map: OrienteeringMap,
  events: JOEEvent[],
  marginDeg = 0.01
): JOEEvent[] {
  return events
    .filter(
      (e): e is JOEEvent & { lat: number; lng: number } =>
        typeof e.lat === "number" && typeof e.lng === "number"
    )
    .filter((e) => isPointInBounds(e.lat, e.lng, map.bounds, marginDeg))
    .sort((a, b) => b.date.localeCompare(a.date));
}
