// Deterministic large fixture: 30 members, 8 cars, 15 nodes, 3 routes.
// Uses a seeded mulberry32 PRNG (no Math.random) so it is fully reproducible.

import type { SolveInput, Weights, SolveOptions } from "../types";
import { DEFAULT_WEIGHTS, DEFAULT_OPTIONS } from "../types";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N_NODES = 15;
const NODES = Array.from({ length: N_NODES }, (_, i) => "n" + i);

// Build a symmetric car travel matrix from deterministic 2D coordinates.
function buildMatrices(rng: () => number) {
  // assign each node a coordinate in a 100x100 grid
  const coords = NODES.map(() => ({ x: rng() * 100, y: rng() * 100 }));
  const car: Record<string, number> = {};
  const transit: Record<string, number> = {};
  for (let i = 0; i < N_NODES; i++)
    for (let j = 0; j < N_NODES; j++) {
      const from = NODES[i];
      const to = NODES[j];
      if (i === j) {
        car[from + ">" + to] = 0;
        transit[from + ">" + to] = 0;
        continue;
      }
      const dx = coords[i].x - coords[j].x;
      const dy = coords[i].y - coords[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const carMin = Math.round(dist * 0.6) + 3; // car speed
      const transitMin = Math.round(dist * 1.0) + 5; // transit slower
      car[from + ">" + to] = carMin;
      transit[from + ">" + to] = transitMin;
    }
  return { car, transit, coords };
}

export interface LargeOverrides {
  seed?: number;
  weights?: Partial<Weights>;
  options?: Partial<SolveOptions>;
  provisional?: boolean;
}

export function makeLarge(ov: LargeOverrides = {}): SolveInput {
  const seed = ov.seed ?? 12345;
  const rng = mulberry32(seed);
  const { car, transit } = buildMatrices(rng);

  // 30 members, each homed at a node 0..14
  const members = Array.from({ length: 30 }, (_, i) => {
    const homeIdx = Math.floor(rng() * N_NODES);
    // two start groups
    const start = rng() < 0.5 ? 540 : 600;
    return { id: "p" + i, startMin: start, homeNodeId: "n" + homeIdx };
  });

  // 8 drivers: pick the first 8 members as drivers (capacity 4 each => 32 seats).
  // first 6 always, last 2 if_needed.
  const cars = Array.from({ length: 8 }, (_, c) => {
    const driver = members[c];
    return {
      driverId: driver.id,
      capacity: 4,
      willingness: (c < 6 ? "always" : "if_needed") as "always" | "if_needed",
      earliestDepMin: null,
      hardNodes: null,
      softNodes: [] as string[],
    };
  });

  // 3 routes with distinct venue-arrival profiles & risk
  const routes = [0, 1, 2].map((k) => {
    const minutesToVenue: Record<string, number> = {};
    for (let n = 0; n < N_NODES; n++) {
      // base venue time per node, route shifts it a little
      minutesToVenue["n" + n] = 25 + Math.round(rng() * 20) + k * 2;
    }
    return { id: "route" + k, riskScore: k + 1, minutesToVenue };
  });

  // pickup hubs: a handful of central nodes
  const pickupNodes = ["n0", "n1", "n2", "n3", "n4"];

  const weights: Weights = { ...DEFAULT_WEIGHTS, ...(ov.weights ?? {}) };
  const options: SolveOptions = {
    ...DEFAULT_OPTIONS,
    ...(ov.options ?? {}),
    provisional: ov.provisional ?? ov.options?.provisional ?? false,
  };

  return {
    members,
    cars,
    routes,
    pickupNodes,
    travel: { car, transit },
    fixed: [],
    locks: [],
    weights,
    options,
  };
}

export const LARGE_NODES = NODES;
