// Hand-crafted small fixture: 12 members, 3 cars, 2 routes, 4 area nodes.
// All travel-matrix entries are fully populated so the base scenario is feasible.

import type { SolveInput, Weights, SolveOptions } from "../types";
import { DEFAULT_WEIGHTS, DEFAULT_OPTIONS } from "../types";

// Area nodes: home areas + pickup hubs
// Nodes: "A","B","C","H" (H = central hub pickup) and "V" implicit venue (route times)
const NODES = ["A", "B", "C", "H"];

// car travel matrix (minutes) between every ordered pair of nodes (from>to)
function carMatrix(): Record<string, number> {
  const base: Record<string, Record<string, number>> = {
    A: { A: 0, B: 12, C: 20, H: 8 },
    B: { A: 12, B: 0, C: 14, H: 7 },
    C: { A: 20, B: 14, C: 0, H: 10 },
    H: { A: 8, B: 7, C: 10, H: 0 },
  };
  const out: Record<string, number> = {};
  for (const from of NODES)
    for (const to of NODES) out[from + ">" + to] = base[from][to];
  return out;
}

// transit matrix (public transport, generally slower) between all pairs
function transitMatrix(): Record<string, number> {
  const base: Record<string, Record<string, number>> = {
    A: { A: 0, B: 22, C: 35, H: 15 },
    B: { A: 22, B: 0, C: 25, H: 12 },
    C: { A: 35, B: 25, C: 0, H: 18 },
    H: { A: 15, B: 12, C: 18, H: 0 },
  };
  const out: Record<string, number> = {};
  for (const from of NODES)
    for (const to of NODES) out[from + ">" + to] = base[from][to];
  return out;
}

export interface SmallOverrides {
  weights?: Partial<Weights>;
  options?: Partial<SolveOptions>;
  fixed?: SolveInput["fixed"];
  locks?: SolveInput["locks"];
  provisional?: boolean;
}

export function makeSmall(ov: SmallOverrides = {}): SolveInput {
  // 12 members. Drivers are m1 (home A), m5 (home B), m9 (home C).
  // start times split into an early group (~600) and a late group (~660).
  const members = [
    { id: "m1", startMin: 600, homeNodeId: "A" }, // driver d1
    { id: "m2", startMin: 600, homeNodeId: "A" },
    { id: "m3", startMin: 660, homeNodeId: "B" },
    { id: "m4", startMin: 660, homeNodeId: "H" },
    { id: "m5", startMin: 660, homeNodeId: "B" }, // driver d2
    { id: "m6", startMin: 600, homeNodeId: "A" },
    { id: "m7", startMin: 600, homeNodeId: "H" },
    { id: "m8", startMin: 660, homeNodeId: "C" },
    { id: "m9", startMin: 660, homeNodeId: "C" }, // driver d3
    { id: "m10", startMin: 600, homeNodeId: "B" },
    { id: "m11", startMin: 660, homeNodeId: "C" },
    { id: "m12", startMin: 600, homeNodeId: "H" },
  ];

  const cars = [
    {
      driverId: "m1",
      capacity: 4,
      willingness: "always" as const,
      earliestDepMin: null,
      hardNodes: null,
      softNodes: [] as string[],
    },
    {
      driverId: "m5",
      capacity: 4,
      willingness: "always" as const,
      earliestDepMin: null,
      hardNodes: null,
      softNodes: [] as string[],
    },
    {
      driverId: "m9",
      capacity: 4,
      willingness: "if_needed" as const,
      earliestDepMin: null,
      hardNodes: null,
      softNodes: [] as string[],
    },
  ];

  const routes = [
    {
      id: "r_main",
      riskScore: 1,
      minutesToVenue: { A: 40, B: 35, C: 30, H: 33 },
    },
    {
      id: "r_alt",
      riskScore: 3,
      minutesToVenue: { A: 38, B: 36, C: 34, H: 31 },
    },
  ];

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
    pickupNodes: ["H"],
    travel: { car: carMatrix(), transit: transitMatrix() },
    fixed: ov.fixed ?? [],
    locks: ov.locks ?? [],
    weights,
    options,
  };
}

export const NODE_LIST = NODES;
