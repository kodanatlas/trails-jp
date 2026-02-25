import type { TrackingEvent, TrackingParticipant, TrackPoint, ControlPoint, SplitEntry } from "./types";

// Seeded PRNG for deterministic tracks
function createRng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  };
}

// Haversine distance in meters
function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const sa = Math.sin(dLat / 2);
  const sb = Math.sin(dLng / 2);
  const h = sa * sa + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * sb * sb;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function generateTrack(
  courseControls: [number, number][],
  avgSpeed: number,
  rng: () => number
): { track: TrackPoint[]; controlTimes: number[] } {
  const points: TrackPoint[] = [];
  const controlTimes: number[] = [0];
  let totalTime = 0;

  for (let i = 0; i < courseControls.length - 1; i++) {
    const from = courseControls[i];
    const to = courseControls[i + 1];
    const dist = haversine(from, to);
    const speedVariation = 0.8 + rng() * 0.4; // 0.8x ~ 1.2x
    const legTime = dist / (avgSpeed * speedVariation);
    const numPoints = Math.max(8, Math.floor(legTime / 2));

    // Generate a slight curve offset
    const midOffsetLat = (rng() - 0.5) * 0.0003;
    const midOffsetLng = (rng() - 0.5) * 0.0003;

    for (let j = 0; j <= numPoints; j++) {
      const t = j / numPoints;
      // Quadratic bezier with random mid offset
      const u = 1 - t;
      const lat = u * u * from[0] + 2 * u * t * ((from[0] + to[0]) / 2 + midOffsetLat) + t * t * to[0];
      const lng = u * u * from[1] + 2 * u * t * ((from[1] + to[1]) / 2 + midOffsetLng) + t * t * to[1];
      // Add GPS noise
      const noiseLat = (rng() - 0.5) * 0.00004;
      const noiseLng = (rng() - 0.5) * 0.00004;
      points.push({
        lat: lat + noiseLat,
        lng: lng + noiseLng,
        time: Math.round(totalTime + legTime * t),
      });
    }

    totalTime += legTime;
    // Control visit time (3-12 seconds)
    totalTime += 3 + rng() * 9;
    controlTimes.push(Math.round(totalTime));
  }

  return { track: points, controlTimes };
}

// ========== Event 1: 代々木公園スプリント ==========

const yoyogiControls: ControlPoint[] = [
  { id: "S", lat: 35.67200, lng: 139.69500 },
  { id: "31", lat: 35.67350, lng: 139.69320 },
  { id: "32", lat: 35.67480, lng: 139.69530 },
  { id: "33", lat: 35.67420, lng: 139.69780 },
  { id: "34", lat: 35.67260, lng: 139.69850 },
  { id: "35", lat: 35.67100, lng: 139.69720 },
  { id: "36", lat: 35.67060, lng: 139.69430 },
  { id: "F", lat: 35.67200, lng: 139.69500 },
];

const yoyogiCourseOrder = ["S", "31", "32", "33", "34", "35", "36", "F"];

const yoyogiCourseCoords: [number, number][] = yoyogiCourseOrder.map((id) => {
  const c = yoyogiControls.find((c) => c.id === id)!;
  return [c.lat, c.lng];
});

interface ParticipantDef {
  id: string;
  name: string;
  club: string;
  color: string;
  className: string;
  startTime: number;
  speed: number;
  seed: number;
}

const yoyogiParticipantDefs: ParticipantDef[] = [
  { id: "p1", name: "田中 太郎", club: "OLK東京", color: "#DC143C", className: "M21E", startTime: 0, speed: 4.5, seed: 1001 },
  { id: "p2", name: "鈴木 花子", club: "横浜OLC", color: "#4169E1", className: "W21E", startTime: 60, speed: 3.8, seed: 2002 },
  { id: "p3", name: "佐藤 健一", club: "京大OLC", color: "#32CD32", className: "M21E", startTime: 120, speed: 4.2, seed: 3003 },
  { id: "p4", name: "山田 美咲", club: "東大OLK", color: "#FF8C00", className: "W21E", startTime: 180, speed: 3.5, seed: 4004 },
  { id: "p5", name: "高橋 翔", club: "名大OLC", color: "#9370DB", className: "M21E", startTime: 240, speed: 4.0, seed: 5005 },
];

function buildParticipants(defs: ParticipantDef[], courseCoords: [number, number][]): { participants: TrackingParticipant[]; allControlTimes: Record<string, number[]> } {
  const participants: TrackingParticipant[] = [];
  const allControlTimes: Record<string, number[]> = {};

  for (const def of defs) {
    const rng = createRng(def.seed);
    const { track, controlTimes } = generateTrack(courseCoords, def.speed, rng);
    const raceTime = track[track.length - 1].time;
    participants.push({
      id: def.id,
      name: def.name,
      club: def.club,
      color: def.color,
      className: def.className,
      startTime: def.startTime,
      raceTime,
      track,
    });
    allControlTimes[def.id] = controlTimes;
  }

  return { participants, allControlTimes };
}

function buildSplits(
  allControlTimes: Record<string, number[]>,
  courseOrder: string[],
  participantIds: string[]
): SplitEntry[] {
  const entries: SplitEntry[] = [];

  for (let ci = 0; ci < courseOrder.length; ci++) {
    const controlId = courseOrder[ci];
    // Collect times for this control
    const times = participantIds.map((pid) => ({
      pid,
      time: allControlTimes[pid]?.[ci] ?? 0,
      leg: ci === 0 ? 0 : (allControlTimes[pid]?.[ci] ?? 0) - (allControlTimes[pid]?.[ci - 1] ?? 0),
    }));
    // Sort by cumulative time for placement
    times.sort((a, b) => a.time - b.time);
    times.forEach((t, i) => {
      entries.push({
        participantId: t.pid,
        controlId,
        time: t.time,
        leg: t.leg,
        place: i + 1,
      });
    });
  }

  return entries;
}

const { participants: yoyogiParticipants, allControlTimes: yoyogiControlTimes } = buildParticipants(
  yoyogiParticipantDefs,
  yoyogiCourseCoords
);

const yoyogiSplits = buildSplits(
  yoyogiControlTimes,
  yoyogiCourseOrder,
  yoyogiParticipantDefs.map((d) => d.id)
);

// ========== Event 2: 小金井公園ミドル ==========

const koganeiControls: ControlPoint[] = [
  { id: "S", lat: 35.7210, lng: 139.5080 },
  { id: "41", lat: 35.7230, lng: 139.5050 },
  { id: "42", lat: 35.7255, lng: 139.5085 },
  { id: "43", lat: 35.7240, lng: 139.5120 },
  { id: "44", lat: 35.7215, lng: 139.5135 },
  { id: "45", lat: 35.7195, lng: 139.5110 },
  { id: "46", lat: 35.7185, lng: 139.5065 },
  { id: "47", lat: 35.7200, lng: 139.5040 },
  { id: "48", lat: 35.7220, lng: 139.5060 },
  { id: "F", lat: 35.7210, lng: 139.5080 },
];

const koganeiCourseOrder = ["S", "41", "42", "43", "44", "45", "46", "47", "48", "F"];

const koganeiCourseCoords: [number, number][] = koganeiCourseOrder.map((id) => {
  const c = koganeiControls.find((c) => c.id === id)!;
  return [c.lat, c.lng];
});

const koganeiParticipantDefs: ParticipantDef[] = [
  { id: "k1", name: "中村 優", club: "OLC三鷹", color: "#E74C3C", className: "M21E", startTime: 0, speed: 4.3, seed: 6001 },
  { id: "k2", name: "渡辺 あかり", club: "国分寺OLC", color: "#3498DB", className: "W21E", startTime: 90, speed: 3.6, seed: 7002 },
  { id: "k3", name: "伊藤 大輔", club: "OLK東京", color: "#2ECC71", className: "M21E", startTime: 60, speed: 4.1, seed: 8003 },
  { id: "k4", name: "小林 真理", club: "練馬OLC", color: "#F39C12", className: "W21E", startTime: 150, speed: 3.4, seed: 9004 },
];

const { participants: koganeiParticipants, allControlTimes: koganeiControlTimes } = buildParticipants(
  koganeiParticipantDefs,
  koganeiCourseCoords
);

const koganeiSplits = buildSplits(
  koganeiControlTimes,
  koganeiCourseOrder,
  koganeiParticipantDefs.map((d) => d.id)
);

// ========== Export all events ==========

export const sampleTrackingEvents: TrackingEvent[] = [
  {
    id: "yoyogi-sprint-2026",
    title: "代々木公園スプリント 2026",
    date: "2026-03-15",
    location: "東京都渋谷区",
    status: "archived",
    center: [35.6720, 139.6950],
    zoom: 16,
    controls: yoyogiControls,
    courseOrder: yoyogiCourseOrder,
    participants: yoyogiParticipants,
    splits: yoyogiSplits,
  },
  {
    id: "koganei-middle-2026",
    title: "小金井公園ミドル 2026",
    date: "2026-04-20",
    location: "東京都小金井市",
    status: "live",
    center: [35.7210, 139.5080],
    zoom: 16,
    controls: koganeiControls,
    courseOrder: koganeiCourseOrder,
    participants: koganeiParticipants,
    splits: koganeiSplits,
  },
];
