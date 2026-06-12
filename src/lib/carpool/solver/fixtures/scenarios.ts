// Purpose-built minimal scenarios for specific test behaviors.
// Fully-populated travel matrices unless a gap is intentionally introduced.

import type { SolveInput, Weights, SolveOptions } from "../types";
import { DEFAULT_WEIGHTS, DEFAULT_OPTIONS } from "../types";

function pairs(nodes: string[], val: (a: string, b: string) => number) {
  const out: Record<string, number> = {};
  for (const a of nodes)
    for (const b of nodes) out[a + ">" + b] = a === b ? 0 : val(a, b);
  return out;
}

// ----- Scenario A: spread separation -----
// 4 members (2 early start=540, 2 late start=600), 2 always cars (cap 2 each),
// both drivers homed together so geography does not force the split — only
// w_spread should drive same-start grouping.
export function spreadScenario(spreadWeight = 1000): SolveInput {
  const nodes = ["X"];
  const members = [
    { id: "early1", startMin: 540, homeNodeId: "X" },
    { id: "early2", startMin: 540, homeNodeId: "X" },
    { id: "late1", startMin: 600, homeNodeId: "X" },
    { id: "late2", startMin: 600, homeNodeId: "X" },
  ];
  const cars = [
    { driverId: "early1", capacity: 2, willingness: "always" as const, earliestDepMin: null, hardNodes: null, softNodes: [] },
    { driverId: "late1", capacity: 2, willingness: "always" as const, earliestDepMin: null, hardNodes: null, softNodes: [] },
  ];
  const routes = [{ id: "r0", riskScore: 0, minutesToVenue: { X: 30 } }];
  const weights: Weights = { ...DEFAULT_WEIGHTS, spread: spreadWeight };
  const options: SolveOptions = { ...DEFAULT_OPTIONS };
  return {
    members, cars, routes, pickupNodes: ["X"],
    travel: { car: pairs(nodes, () => 5), transit: pairs(nodes, () => 10) },
    fixed: [], locks: [], weights, options,
  };
}

// ----- Scenario B: if_needed activation -----
// makeIfNeeded(n): n members, one always car (cap = capAlways), one if_needed car.
// If capAlways >= n -> if_needed should stay off. If capAlways < n -> it activates.
export function ifNeededScenario(n: number, capAlways: number): SolveInput {
  const nodes = ["X"];
  const members = Array.from({ length: n }, (_, i) => ({
    id: "u" + i, startMin: 540, homeNodeId: "X",
  }));
  const cars = [
    { driverId: "u0", capacity: capAlways, willingness: "always" as const, earliestDepMin: null, hardNodes: null, softNodes: [] },
    { driverId: "u1", capacity: 4, willingness: "if_needed" as const, earliestDepMin: null, hardNodes: null, softNodes: [] },
  ];
  const routes = [{ id: "r0", riskScore: 0, minutesToVenue: { X: 30 } }];
  return {
    members, cars, routes, pickupNodes: ["X"],
    travel: { car: pairs(nodes, () => 5), transit: pairs(nodes, () => 10) },
    fixed: [], locks: [], weights: { ...DEFAULT_WEIGHTS }, options: { ...DEFAULT_OPTIONS },
  };
}

// ----- Scenario C: earliest-departure (ed_c) -----
// Constraint (16): for an active car c, smin_c - T_c - BigM*z_c >= ed_c + B - BigM,
// i.e. when z_c=1 every member's start in car c must be >= ed_c + B + T_c.
//
// Layout (3 cars, all "always"):
//   carEarly (driver driverEarly@X, start 540, ed=null, capacity 1)
//       -> seats only its own driver; it CANNOT absorb earlyM.
//   carLate  (driver driverLate@Y,  start 600, ed=480, capacity 4)
//       -> the ed-car. With B=75 and T_late=base(r0,Y)=30 the (16) bound is
//          smin_late >= 480+75+30 = 585. driverLate(600) and lateM(600) satisfy
//          it; earlyM(540) does NOT, so (16) excludes earlyM from carLate.
//          Driver-feasibility (item a): ed(480) <= start_driver(600) - B(75) -
//          T(30) = 495, so the car is feasible to drive for its own driver.
//   carMid   (driver driverMid@Z,   start 540, ed=null, capacity 4)
//       -> the fallback early car that legitimately seats earlyM.
//
// Cost gradient (spread weight forced to 0 so spread does not interfere):
//   earlyM(home X) boarding carLate costs access transit(X,Y)=5 — cheaper than
//   boarding carMid via transit(X,Z)=40. So WITHOUT (16) the solver puts earlyM
//   in carLate; WITH (16) earlyM is excluded and lands in carMid. Hence the
//   test "earlyM not in carLate" only passes when (16) is correctly active.
export function edScenario(): SolveInput {
  const nodes = ["X", "Y", "Z"];
  const members = [
    { id: "driverEarly", startMin: 540, homeNodeId: "X" },
    { id: "driverLate", startMin: 600, homeNodeId: "Y" },
    { id: "driverMid", startMin: 540, homeNodeId: "Z" },
    { id: "earlyM", startMin: 540, homeNodeId: "X" },
    { id: "lateM", startMin: 600, homeNodeId: "Y" },
  ];
  const cars = [
    { driverId: "driverEarly", capacity: 1, willingness: "always" as const, earliestDepMin: null, hardNodes: null, softNodes: [] },
    { driverId: "driverLate", capacity: 4, willingness: "always" as const, earliestDepMin: 480, hardNodes: null, softNodes: [] },
    { driverId: "driverMid", capacity: 4, willingness: "always" as const, earliestDepMin: null, hardNodes: null, softNodes: [] },
  ];
  const routes = [{ id: "r0", riskScore: 0, minutesToVenue: { X: 30, Y: 30, Z: 30 } }];
  // car matrix uniform; transit gradient makes carLate the cheaper option for earlyM.
  const transit: Record<string, number> = {};
  for (const a of nodes)
    for (const b of nodes) {
      if (a === b) { transit[a + ">" + b] = 0; continue; }
      // X<->Y close (5), everything else far but within accessMax 45 (40).
      transit[a + ">" + b] = (a === "X" && b === "Y") || (a === "Y" && b === "X") ? 5 : 40;
    }
  return {
    members, cars, routes, pickupNodes: ["X", "Y", "Z"],
    travel: { car: pairs(nodes, () => 10), transit },
    fixed: [], locks: [],
    // spread weight 0 so the only differentiator for earlyM is access vs (16).
    weights: { ...DEFAULT_WEIGHTS, spread: 0 },
    options: { ...DEFAULT_OPTIONS, bufferMin: 75 },
  };
}

// ----- Scenario D: matrix gap -----
// A car restricted to hard pickup node H. A rider homed at B must reach H by
// transit, but the transit entry B>H is missing -> the rider is isolated and
// §6-5/§6-6 must surface a Japanese message naming the gap (B, transit).
export function gapScenario(): SolveInput {
  const nodes = ["A", "B", "H"];
  const members = [
    { id: "d1", startMin: 540, homeNodeId: "A" },
    { id: "rider", startMin: 540, homeNodeId: "B" },
  ];
  const cars = [
    {
      driverId: "d1",
      capacity: 4,
      willingness: "always" as const,
      earliestDepMin: null,
      hardNodes: ["H"],
      softNodes: [],
    },
  ];
  const routes = [{ id: "r0", riskScore: 0, minutesToVenue: { A: 30, B: 30, H: 30 } }];
  const car = pairs(nodes, () => 10);
  // transit fully populated EXCEPT the entry the rider needs to reach hub H.
  const transit = pairs(nodes, () => 12);
  delete transit["B>H"];
  return {
    members,
    cars,
    routes,
    pickupNodes: ["H"],
    travel: { car, transit },
    fixed: [],
    locks: [],
    weights: { ...DEFAULT_WEIGHTS },
    options: { ...DEFAULT_OPTIONS },
  };
}

// ----- Scenario E: missing δ (route time at a pickup node) -----
// δ(c,p,k) is undefined when rt(k,p) is missing, so the detour variable
// v[c,p,k] is never created. But u[c,p] and r[c,k] can still BOTH exist (the
// node is usable on another route, and base(c,k)=rt(k,home_c) is present). The
// (12b) "nodelta" constraint must then forbid co-selecting that route and that
// stop — otherwise the solver routes via the cheaper route while picking the
// rider up "for free" at a node the route never actually visits.
//
// Here route "rBad" omits rt at pickup node "P" and carries risk 0 (cheap),
// while "rGood" has rt(P) and risk 5 (costly). The single rider boards only at P
// (its home). Without (12b) the solver would pick rBad + free P stop; with (12b)
// it is forced onto rGood.
export function noDeltaScenario(): SolveInput {
  const nodes = ["HOME", "P"];
  const members = [
    { id: "d1", startMin: 540, homeNodeId: "HOME" },
    { id: "r1", startMin: 540, homeNodeId: "P" },
  ];
  const cars = [
    {
      driverId: "d1",
      capacity: 4,
      willingness: "always" as const,
      earliestDepMin: null,
      // restrict riders to pickup node P so r1 cannot side-step to the driver's
      // home node; this makes the route forced onto rGood by (12b).
      hardNodes: ["P"],
      softNodes: [],
    },
  ];
  const routes: SolveInput["routes"] = [
    // rGood: has a venue time at P (δ defined) but is risky.
    { id: "rGood", riskScore: 5, minutesToVenue: { HOME: 30, P: 30 } },
    // rBad: cheaper (risk 0) but MISSING the P venue time -> δ(d1,P,rBad) undefined.
    { id: "rBad", riskScore: 0, minutesToVenue: { HOME: 30 } },
  ];
  return {
    members,
    cars,
    routes,
    pickupNodes: ["P"],
    travel: { car: pairs(nodes, () => 10), transit: pairs(nodes, () => 12) },
    fixed: [],
    locks: [],
    weights: { ...DEFAULT_WEIGHTS },
    options: { ...DEFAULT_OPTIONS },
  };
}
