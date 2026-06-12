// Orchestrator: validate -> buildLp -> highs.solve -> extract result.

import type { SolveInput, SolveResult, HighsLike } from "./types";
import { validate } from "./validate";
import { buildLpFromModel } from "./lp";
import { buildModel } from "./model";
import { extractCars, computeKpi } from "./postprocess";

const EMPTY_KPI = {
  totalDriveMin: 0,
  totalAccessMin: 0,
  maxSpreadMin: 0,
  carsUsed: 0,
};

export interface SolveCarpoolOptions {
  timeLimitSec?: number;
  mipRelGap?: number;
}

// Defaults rationale: on the 30-member / 8-car reference fixture (case10) HiGHS
// finds a feasible incumbent in well under a second, but *proving* optimality
// can take tens of seconds. A 5 s wall clock combined with a 3 % relative MIP
// gap reliably returns a high-quality, practically optimal plan at that scale
// while keeping the UI responsive (verified by case10). Callers needing a proven
// optimum can raise timeLimitSec / lower mipRelGap.
const DEFAULT_TIME_LIMIT_SEC = 5;
const DEFAULT_MIP_REL_GAP = 0.03;

export function solveCarpool(
  input: SolveInput,
  highs: HighsLike,
  opts: SolveCarpoolOptions = {},
): SolveResult {
  const validationErrors = validate(input);
  if (validationErrors.length > 0) {
    return { status: "error", cars: [], kpi: EMPTY_KPI, validationErrors };
  }

  // Build the model exactly once and thread it through LP construction and KPI.
  const model = buildModel(input);
  const { lp, registry } = buildLpFromModel(model);

  const solverOptions = {
    output_flag: false,
    log_to_console: false,
    presolve: "on",
    parallel: "on",
    time_limit: opts.timeLimitSec ?? DEFAULT_TIME_LIMIT_SEC,
    mip_rel_gap: opts.mipRelGap ?? DEFAULT_MIP_REL_GAP,
  };

  let result;
  try {
    result = highs.solve(lp, solverOptions);
  } catch (e) {
    return {
      status: "error",
      cars: [],
      kpi: EMPTY_KPI,
      validationErrors: [
        "ソルバ実行エラー: " + (e instanceof Error ? e.message : String(e)),
      ],
    };
  }

  if (result.Status === "Infeasible") {
    return { status: "infeasible", cars: [], kpi: EMPTY_KPI, validationErrors: [] };
  }

  // Accept Optimal and time-limited / bound-reached solutions, but ONLY when an
  // actual incumbent exists. "Time limit reached" can be returned *without* any
  // feasible solution; in that case the objective is not finite and the y
  // columns carry no Primal. Treating that as optimal would hand back an empty
  // plan that silently drops every member.
  const acceptableStatuses = new Set([
    "Optimal",
    "Time limit reached",
    "Bound on objective reached",
    "Target for objective reached",
  ]);
  if (!acceptableStatuses.has(result.Status)) {
    return {
      status: "error",
      cars: [],
      kpi: EMPTY_KPI,
      validationErrors: ["ソルバ状態: " + result.Status],
    };
  }

  if (!hasIncumbent(result, registry)) {
    return {
      status: "error",
      cars: [],
      kpi: EMPTY_KPI,
      validationErrors: [
        "ソルバが時間内に実行可能解を見つけられませんでした。時間制限（timeLimitSec）を増やしてください",
      ],
    };
  }

  const cars = extractCars({ model, registry, result });
  const kpi = computeKpi(model, cars);

  return { status: "optimal", cars, kpi, validationErrors: [] };
}

// An incumbent exists iff the objective is finite AND at least one assignment
// (y) column came back with a usable Primal value.
function hasIncumbent(
  result: { ObjectiveValue: number; Columns: Record<string, { Primal?: number }> },
  registry: { y: Map<string, string> },
): boolean {
  if (!Number.isFinite(result.ObjectiveValue)) return false;
  for (const yName of registry.y.values()) {
    const col = result.Columns[yName];
    if (col && col.Primal !== undefined && Number.isFinite(col.Primal)) return true;
  }
  return false;
}

export { buildLp, buildLpDetailed, buildLpFromModel } from "./lp";
export { expandSchedule } from "./postprocess";
export { validate } from "./validate";
export type { CarSchedule, ScheduleStop, ExpandScheduleResult } from "./postprocess";
