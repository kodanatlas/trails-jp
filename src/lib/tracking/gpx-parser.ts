import type { TrackPoint } from "./types";

/**
 * GPXファイル（テキスト）をパースしてTrackPoint配列を返す
 */
export function parseGpx(gpxText: string): TrackPoint[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxText, "application/xml");
  const points: TrackPoint[] = [];

  const trkpts = doc.querySelectorAll("trkpt");
  if (trkpts.length === 0) return points;

  let baseTime: number | null = null;

  trkpts.forEach((pt) => {
    const lat = parseFloat(pt.getAttribute("lat") ?? "0");
    const lng = parseFloat(pt.getAttribute("lon") ?? "0");
    const eleEl = pt.querySelector("ele");
    const timeEl = pt.querySelector("time");

    const elevation = eleEl ? parseFloat(eleEl.textContent ?? "0") : undefined;

    let time = 0;
    if (timeEl?.textContent) {
      const ts = new Date(timeEl.textContent).getTime() / 1000;
      if (baseTime === null) baseTime = ts;
      time = Math.round(ts - baseTime);
    }

    points.push({ lat, lng, time, elevation });
  });

  return points;
}
