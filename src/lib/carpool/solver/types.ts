// Carpool MILP solver — shared types.
// Strictly conforms to the documented SolveInput / SolveResult interfaces.

export interface Member {
  id: string;
  startMin: number | null;
  homeNodeId: string;
}

export interface Car {
  driverId: string;
  capacity: number;
  willingness: "always" | "if_needed";
  earliestDepMin: number | null;
  hardNodes: string[] | null;
  softNodes: string[];
}

export interface Route {
  id: string;
  riskScore: number;
  minutesToVenue: Record<string, number>;
}

export interface Travel {
  /** key: "from>to" */
  car: Record<string, number>;
  /** key: "from>to" */
  transit: Record<string, number>;
}

export interface FixedAssignment {
  memberId: string;
  driverId: string;
}

export interface Lock {
  memberId?: string;
  driverId: string;
  nodeId?: string;
  routeId?: string;
}

export interface Weights {
  drive: number;
  spread: number;
  access: number;
  risk: number;
  car: number;
  soft: number;
}

export interface SolveOptions {
  bufferMin: number;
  maxPickups: number;
  accessMaxMin: number;
  provisional: boolean;
}

export interface SolveInput {
  members: Member[];
  cars: Car[];
  routes: Route[];
  pickupNodes: string[];
  travel: Travel;
  fixed: FixedAssignment[];
  locks: Lock[];
  weights: Weights;
  options: SolveOptions;
}

export interface ResultRider {
  memberId: string;
  nodeId: string;
}

export interface ResultCar {
  driverId: string;
  routeId: string;
  riders: ResultRider[];
  driveMin: number;
  spreadMin: number;
}

export interface Kpi {
  totalDriveMin: number;
  totalAccessMin: number;
  maxSpreadMin: number;
  carsUsed: number;
}

export interface SolveResult {
  status: "optimal" | "infeasible" | "error";
  cars: ResultCar[];
  kpi: Kpi;
  validationErrors: string[];
}

// --- Minimal local highs interface (avoids importing highs types directly) ---

export interface HighsColumn {
  Primal?: number;
  Name?: string;
  Type?: "Integer" | "Continuous";
  Index?: number;
  Lower?: number | null;
  Upper?: number | null;
}

export interface HighsResult {
  Status: string;
  ObjectiveValue: number;
  Columns: Record<string, HighsColumn>;
  Rows: unknown[];
}

export interface HighsLike {
  solve(lp: string, options?: unknown): HighsResult;
}

// Default weights & options (documented).
export const DEFAULT_WEIGHTS: Weights = {
  drive: 1.0,
  spread: 1.0,
  access: 0.5,
  risk: 15,
  car: 60,
  soft: 20,
};

export const DEFAULT_OPTIONS: SolveOptions = {
  bufferMin: 75,
  maxPickups: 2,
  accessMaxMin: 45,
  provisional: false,
};

export const BIG_M = 1440;
