// Post-processing: convert a solved column map into SolveResult cars/kpi,
// and expand a per-car pickup/departure schedule (§7-1).

import type {
  SolveInput,
  SolveResult,
  ResultCar,
  ResultRider,
  HighsResult,
} from "./types";
import type { VarRegistry } from "./lp";
import { buildModel, type Model } from "./model";

function bin(col: { Primal?: number } | undefined): boolean {
  if (!col || col.Primal === undefined) return false;
  // The MILP makes these variables genuinely binary, so a >0.5 Primal means
  // "selected"; no rounding needed.
  return col.Primal > 0.5;
}

function num(col: { Primal?: number } | undefined): number {
  if (!col || col.Primal === undefined) return 0;
  return col.Primal;
}

export interface ExtractContext {
  model: Model;
  registry: VarRegistry;
  result: HighsResult;
}

// Build SolveResult.cars from solved columns.
export function extractCars(ctx: ExtractContext): ResultCar[] {
  const { model, registry, result } = ctx;
  const cols = result.Columns;
  const { members, cars, routes } = model;
  const M = members.length;
  const D = cars.length;
  const K = routes.length;
  const nodes = registry.nodes;

  // Per-member start lookup for recomputing spread directly from assignments.
  const startOf = (memberId: string): number | null => {
    const i = model.memberIndex.get(memberId);
    return i === undefined ? null : members[i].startMin;
  };

  const out: ResultCar[] = [];

  for (let c = 0; c < D; c++) {
    const zName = registry.z.get(c);
    if (!bin(cols[zName ?? ""])) continue; // car not active

    // route
    let routeId = "";
    for (let k = 0; k < K; k++) {
      const rName = registry.r.get(c + "_" + k);
      if (bin(cols[rName ?? ""])) {
        routeId = routes[k].id;
        break;
      }
    }

    // riders (members assigned to this car)
    const riders: ResultRider[] = [];
    const driverIdx = model.carDriverMemberIndex(c);
    for (let i = 0; i < M; i++) {
      const yName = registry.y.get(i + "_" + c);
      if (!bin(cols[yName ?? ""])) continue;
      if (i === driverIdx) {
        // driver boards at own home
        riders.push({ memberId: members[i].id, nodeId: model.homeOf(i) });
        continue;
      }
      // find boarding node from b vars
      let nodeId: string | null = null;
      for (let p = 0; p < nodes.length; p++) {
        const bName = registry.b.get(i + "_" + c + "_" + p);
        if (bin(cols[bName ?? ""])) {
          nodeId = nodes[p];
          break;
        }
      }
      if (nodeId === null) {
        // No boarding node selected despite y[i,c]=1. Constraint (7) should make
        // this impossible; falling back to home indicates a solver/model
        // inconsistency, so default conservatively to the member's home area.
        nodeId = model.homeOf(i);
      }
      riders.push({ memberId: members[i].id, nodeId });
    }

    const driveMin = Math.round(num(cols[registry.T.get(c) ?? ""]));

    // Recompute spread from the assigned members' start times rather than the
    // smin/smax variables: when w_spread = 0 those variables are unconstrained
    // from below/above and can settle at values that overstate the true spread.
    const startsInCar = riders
      .map((r) => startOf(r.memberId))
      .filter((s): s is number => s !== null);
    const spreadMin =
      startsInCar.length > 0
        ? Math.max(...startsInCar) - Math.min(...startsInCar)
        : 0;

    out.push({ driverId: cars[c].driverId, routeId, riders, driveMin, spreadMin });
  }

  return out;
}

export function computeKpi(model: Model, cars: ResultCar[]): SolveResult["kpi"] {
  let totalDriveMin = 0;
  let totalAccessMin = 0;
  let maxSpreadMin = 0;
  for (const car of cars) {
    totalDriveMin += car.driveMin;
    maxSpreadMin = Math.max(maxSpreadMin, car.spreadMin);
    const carIdx = model.carIndex.get(car.driverId);
    for (const rider of car.riders) {
      const i = model.memberIndex.get(rider.memberId);
      if (i === undefined) continue;
      if (carIdx !== undefined && model.carDriverMemberIndex(carIdx) === i) continue; // driver, a=0
      const a = model.access(i, rider.nodeId);
      if (a !== undefined) totalAccessMin += a;
    }
  }
  return {
    totalDriveMin,
    totalAccessMin,
    maxSpreadMin,
    carsUsed: cars.length,
  };
}

// §7-1 schedule expansion: order pickups by car(home_c, p) ascending (approx),
// then back-calculate departure / pickup / venue-arrival times.
export interface ScheduleStop {
  nodeId: string;
  memberIds: string[];
  arriveMin: number; // minutes-of-day when the car reaches this node
}

export interface CarSchedule {
  driverId: string;
  routeId: string;
  departMin: number; // when car leaves driver home
  stops: ScheduleStop[];
  venueArriveMin: number;
}

export interface ExpandScheduleResult {
  schedules: CarSchedule[];
  // Japanese warnings raised when a travel-matrix entry needed for timing is
  // missing (treated as 0 so a schedule is still produced, but flagged).
  warnings: string[];
}

export function expandSchedule(
  input: SolveInput,
  resultCars: ResultCar[],
  model: Model = buildModel(input),
): ExpandScheduleResult {
  const schedules: CarSchedule[] = [];
  const warnings: string[] = [];

  for (const car of resultCars) {
    const c = model.carIndex.get(car.driverId);
    if (c === undefined) continue;
    const home = model.carHome(c);
    const k = model.routeIndex.get(car.routeId);

    // group riders by pickup node, excluding driver-at-home
    const driverIdx = model.carDriverMemberIndex(c);
    const byNode = new Map<string, string[]>();
    for (const rider of car.riders) {
      const i = model.memberIndex.get(rider.memberId);
      if (i !== undefined && i === driverIdx) continue; // driver
      const arr = byNode.get(rider.nodeId) ?? [];
      arr.push(rider.memberId);
      byNode.set(rider.nodeId, arr);
    }

    // order pickup nodes by car(home, node) ascending
    const pickupNodes = Array.from(byNode.keys()).sort((a, b) => {
      const da = model.carTravel(home, a) ?? Number.POSITIVE_INFINITY;
      const db = model.carTravel(home, b) ?? Number.POSITIVE_INFINITY;
      return da - db;
    });

    // venue arrival target: earliest member start - buffer, else 0
    const starts = car.riders
      .map((r) => {
        const i = model.memberIndex.get(r.memberId);
        return i !== undefined ? model.members[i].startMin : null;
      })
      .filter((s): s is number => s !== null);
    const earliestStart = starts.length > 0 ? Math.min(...starts) : null;

    // forward-build cumulative travel from home through pickups then venue
    let cursor = home;
    let cumulative = 0; // minutes from departure
    const stopTimings: { nodeId: string; cumulative: number }[] = [];
    for (const node of pickupNodes) {
      const legRaw = model.carTravel(cursor, node);
      if (legRaw === undefined) {
        warnings.push(
          `移動時間が未入力のため時刻が不正確です: ${cursor}→${node} (car)`,
        );
      }
      cumulative += legRaw ?? 0;
      stopTimings.push({ nodeId: node, cumulative });
      cursor = node;
    }
    // final leg to venue via route k
    let venueLeg = 0;
    if (k !== undefined) {
      const rt = model.routeTime(k, cursor);
      if (rt === undefined) {
        warnings.push(
          `移動時間が未入力のため時刻が不正確です: ${cursor}→会場 (route ${car.routeId})`,
        );
      }
      venueLeg = rt ?? 0;
    }
    const totalToVenue = cumulative + venueLeg;

    // departure time: aim to arrive buffer before earliest start
    const buffer = input.options.bufferMin;
    let venueArriveMin: number;
    if (earliestStart !== null) {
      venueArriveMin = earliestStart - buffer;
    } else {
      venueArriveMin = totalToVenue; // arbitrary baseline when no starts
    }
    const departMin = venueArriveMin - totalToVenue;

    const stops: ScheduleStop[] = stopTimings.map((st) => ({
      nodeId: st.nodeId,
      memberIds: byNode.get(st.nodeId) ?? [],
      arriveMin: departMin + st.cumulative,
    }));

    schedules.push({
      driverId: car.driverId,
      routeId: car.routeId,
      departMin,
      stops,
      venueArriveMin: departMin + totalToVenue,
    });
  }

  return { schedules, warnings };
}
