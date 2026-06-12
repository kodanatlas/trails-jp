import type { SolveInput } from "./types";
import { BIG_M } from "./types";
import { buildModel, type Model } from "./model";

export interface VarRegistry {
  y: Map<string, string>;
  z: Map<number, string>;
  r: Map<string, string>;
  b: Map<string, string>;
  u: Map<string, string>;
  v: Map<string, string>;
  T: Map<number, string>;
  smax: Map<number, string>;
  smin: Map<number, string>;
  spread: Map<number, string>;
  nodeIndex: Map<string, number>;
  nodes: string[];
}

export interface BuildLpOutput {
  lp: string;
  registry: VarRegistry;
  model: Model;
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(6).replace(/\.?0+$/, "");
}

function term(coef: number, varName: string): string {
  const sign = coef < 0 ? "-" : "+";
  const mag = Math.abs(coef);
  return sign + " " + fmt(mag) + " " + varName;
}

// Build the LP from a pre-derived model. solve.ts uses this so the model is
// constructed exactly once across LP construction, KPI and schedule expansion.
export function buildLpFromModel(model: Model): BuildLpOutput {
  const input = model.input;
  const { members, cars, routes, P } = model;
  const M = members.length;
  const D = cars.length;
  const K = routes.length;

  const nodes = P;
  const nodeIndex = new Map<string, number>();
  nodes.forEach((n, idx) => nodeIndex.set(n, idx));
  const NP = nodes.length;

  const reg: VarRegistry = {
    y: new Map(), z: new Map(), r: new Map(), b: new Map(), u: new Map(),
    v: new Map(), T: new Map(), smax: new Map(), smin: new Map(),
    spread: new Map(), nodeIndex, nodes,
  };

  const vy = (i: number, c: number) => "y_" + i + "_" + c;
  const vz = (c: number) => "z_" + c;
  const vr = (c: number, k: number) => "r_" + c + "_" + k;
  const vb = (i: number, c: number, p: number) => "b_" + i + "_" + c + "_" + p;
  const vu = (c: number, p: number) => "u_" + c + "_" + p;
  const vv = (c: number, p: number, k: number) => "v_" + c + "_" + p + "_" + k;
  const vT = (c: number) => "T_" + c;
  const vsmax = (c: number) => "smax_" + c;
  const vsmin = (c: number) => "smin_" + c;
  const vspread = (c: number) => "spread_" + c;

  const provisional = input.options.provisional;
  const w = input.weights;
  const Pmax = input.options.maxPickups;
  const B = input.options.bufferMin;
  const accessMax = input.options.accessMaxMin;

  // ---- feasibility pruning ----
  // routeOk[c][k]: base(c,k) defined
  const routeOk: boolean[][] = [];
  for (let c = 0; c < D; c++) {
    routeOk[c] = [];
    for (let k = 0; k < K; k++) routeOk[c][k] = model.baseCK(c, k) !== undefined;
  }
  // nodeUsable[c][p]: p in allowed(c) AND at least one route k with delta defined
  const nodeUsable: boolean[][] = [];
  for (let c = 0; c < D; c++) {
    const allowedSet = new Set(model.allowed(c));
    nodeUsable[c] = [];
    for (let p = 0; p < NP; p++) {
      if (!allowedSet.has(nodes[p])) { nodeUsable[c][p] = false; continue; }
      let any = false;
      for (let k = 0; k < K; k++)
        if (model.delta(c, nodes[p], k) !== undefined) { any = true; break; }
      nodeUsable[c][p] = any;
    }
  }
  // boardOk[i][c][p]: i!=driver, nodeUsable, access defined and <= accessMax
  const driverMemberIdx = (c: number) => model.carDriverMemberIndex(c);
  const boardOk = (i: number, c: number, p: number): boolean => {
    if (i === driverMemberIdx(c)) return false;
    if (!nodeUsable[c][p]) return false;
    const a = model.access(i, nodes[p]);
    return a !== undefined && a <= accessMax;
  };

  // declare variables (only feasible ones)
  for (let i = 0; i < M; i++)
    for (let c = 0; c < D; c++) reg.y.set(i + "_" + c, vy(i, c));
  for (let c = 0; c < D; c++) reg.z.set(c, vz(c));
  for (let c = 0; c < D; c++)
    for (let k = 0; k < K; k++)
      if (routeOk[c][k]) reg.r.set(c + "_" + k, vr(c, k));
  for (let c = 0; c < D; c++)
    for (let p = 0; p < NP; p++)
      if (nodeUsable[c][p]) reg.u.set(c + "_" + p, vu(c, p));
  for (let i = 0; i < M; i++)
    for (let c = 0; c < D; c++)
      for (let p = 0; p < NP; p++)
        if (boardOk(i, c, p)) reg.b.set(i + "_" + c + "_" + p, vb(i, c, p));
  for (let c = 0; c < D; c++)
    for (let p = 0; p < NP; p++) {
      if (!nodeUsable[c][p]) continue;
      for (let k = 0; k < K; k++)
        if (routeOk[c][k] && model.delta(c, nodes[p], k) !== undefined)
          reg.v.set(c + "_" + p + "_" + k, vv(c, p, k));
    }
  for (let c = 0; c < D; c++) reg.T.set(c, vT(c));
  if (!provisional)
    for (let c = 0; c < D; c++) {
      reg.smax.set(c, vsmax(c));
      reg.smin.set(c, vsmin(c));
      reg.spread.set(c, vspread(c));
    }

  const hasU = (c: number, p: number) => reg.u.has(c + "_" + p);
  const hasB = (i: number, c: number, p: number) => reg.b.has(i + "_" + c + "_" + p);
  const hasR = (c: number, k: number) => reg.r.has(c + "_" + k);
  const hasV = (c: number, p: number, k: number) => reg.v.has(c + "_" + p + "_" + k);

  // ===== Objective =====
  const objTerms: string[] = [];
  for (let c = 0; c < D; c++) objTerms.push(term(w.drive, vT(c)));
  if (!provisional)
    for (let c = 0; c < D; c++) objTerms.push(term(w.spread, vspread(c)));
  for (let i = 0; i < M; i++)
    for (let c = 0; c < D; c++)
      for (let p = 0; p < NP; p++) {
        if (!hasB(i, c, p)) continue;
        const a = model.access(i, nodes[p]);
        if (a === undefined || a === 0) continue;
        objTerms.push(term(w.access * a, vb(i, c, p)));
      }
  for (let c = 0; c < D; c++)
    for (let k = 0; k < K; k++) {
      if (!hasR(c, k)) continue;
      const rho = routes[k].riskScore;
      if (rho === 0) continue;
      objTerms.push(term(w.risk * rho, vr(c, k)));
    }
  for (let c = 0; c < D; c++) {
    const kappa = cars[c].willingness === "if_needed" ? 1 : 0;
    if (kappa === 0) continue;
    objTerms.push(term(w.car, vz(c)));
  }
  for (let c = 0; c < D; c++) {
    const pref = model.pref(c);
    if (pref.size === 0) continue;
    for (let p = 0; p < NP; p++) {
      if (!hasU(c, p)) continue;
      if (pref.has(nodes[p])) continue;
      objTerms.push(term(w.soft, vu(c, p)));
    }
  }
  // An empty objective only arises with no cars (D=0); validate() already raises
  // "運転手がいません" in that case. Emit a literal 0 constant rather than
  // referencing a non-existent z_0 variable.
  if (objTerms.length === 0) objTerms.push("0");

  const cons: string[] = [];
  let cn = 0;
  const addCon = (label: string, body: string) => {
    cons.push(" c" + cn + "_" + label + ": " + body);
    cn++;
  };

  // (1) sum_c y[i,c] = 1
  for (let i = 0; i < M; i++) {
    const t: string[] = [];
    for (let c = 0; c < D; c++) t.push(term(1, vy(i, c)));
    addCon("assign_" + i, t.join(" ") + " = 1");
  }
  // (2) y[i,c] - z_c <= 0 (i != driver)
  for (let i = 0; i < M; i++)
    for (let c = 0; c < D; c++) {
      if (i === driverMemberIdx(c)) continue;
      addCon("link_" + i + "_" + c, term(1, vy(i, c)) + " " + term(-1, vz(c)) + " <= 0");
    }
  // (3) y[driver,c] - z_c = 0
  for (let c = 0; c < D; c++) {
    const d = driverMemberIdx(c);
    if (d < 0) continue;
    addCon("driveself_" + c, term(1, vy(d, c)) + " " + term(-1, vz(c)) + " = 0");
  }
  // (5) sum_i y[i,c] <= cap
  for (let c = 0; c < D; c++) {
    const t: string[] = [];
    for (let i = 0; i < M; i++) t.push(term(1, vy(i, c)));
    addCon("cap_" + c, t.join(" ") + " <= " + fmt(cars[c].capacity));
  }
  // (7) sum_p b[i,c,p] - y[i,c] = 0 (i != driver)
  // If a rider has NO feasible board node for car c, the row degenerates to
  // "- y[i,c] = 0", which still correctly forces y[i,c] = 0.
  for (let c = 0; c < D; c++)
    for (let i = 0; i < M; i++) {
      if (i === driverMemberIdx(c)) continue;
      const t: string[] = [];
      for (let p = 0; p < NP; p++) if (hasB(i, c, p)) t.push(term(1, vb(i, c, p)));
      t.push(term(-1, vy(i, c)));
      addCon("board_" + i + "_" + c, t.join(" ") + " = 0");
    }
  // (8) b[i,c,p] - u[c,p] <= 0
  for (let i = 0; i < M; i++)
    for (let c = 0; c < D; c++)
      for (let p = 0; p < NP; p++) {
        if (!hasB(i, c, p)) continue;
        addCon("useu_" + i + "_" + c + "_" + p, term(1, vb(i, c, p)) + " " + term(-1, vu(c, p)) + " <= 0");
      }
  // (9) sum_p u[c,p] - Pmax z_c <= 0
  for (let c = 0; c < D; c++) {
    const t: string[] = [];
    for (let p = 0; p < NP; p++) if (hasU(c, p)) t.push(term(1, vu(c, p)));
    t.push(term(-Pmax, vz(c)));
    addCon("pmax_" + c, t.join(" ") + " <= 0");
  }
  // (11) sum_k r[c,k] - z_c = 0
  for (let c = 0; c < D; c++) {
    const t: string[] = [];
    for (let k = 0; k < K; k++) if (hasR(c, k)) t.push(term(1, vr(c, k)));
    t.push(term(-1, vz(c)));
    addCon("route_" + c, t.join(" ") + " = 0");
  }
  // (12) v >= u + r - 1 ; v <= u ; v <= r
  for (let c = 0; c < D; c++)
    for (let p = 0; p < NP; p++)
      for (let k = 0; k < K; k++) {
        if (!hasV(c, p, k)) continue;
        addCon("vlb_" + c + "_" + p + "_" + k, term(1, vv(c, p, k)) + " " + term(-1, vu(c, p)) + " " + term(-1, vr(c, k)) + " >= -1");
        addCon("vu_" + c + "_" + p + "_" + k, term(1, vv(c, p, k)) + " " + term(-1, vu(c, p)) + " <= 0");
        addCon("vr_" + c + "_" + p + "_" + k, term(1, vv(c, p, k)) + " " + term(-1, vr(c, k)) + " <= 0");
      }
  // (12b) nodelta: when v[c,p,k] cannot exist because δ(c,p,k) is undefined
  // (rt(k,p) or car(home_c,p) missing) but BOTH u[c,p] and r[c,k] exist, the
  // pair (stop at p, route k) would otherwise be selectable at ZERO detour cost
  // — a physically impossible plan. Forbid co-selection: u[c,p] + r[c,k] <= 1.
  for (let c = 0; c < D; c++)
    for (let p = 0; p < NP; p++) {
      if (!hasU(c, p)) continue;
      for (let k = 0; k < K; k++) {
        if (!hasR(c, k)) continue;
        if (hasV(c, p, k)) continue; // δ defined -> handled by (12)/(13)
        addCon("nodelta_" + c + "_" + p + "_" + k, term(1, vu(c, p)) + " " + term(1, vr(c, k)) + " <= 1");
      }
    }
  // (13) T_c = sum_k base r + sum_pk delta v
  for (let c = 0; c < D; c++) {
    const t: string[] = [term(1, vT(c))];
    for (let k = 0; k < K; k++) {
      if (!hasR(c, k)) continue;
      const base = model.baseCK(c, k);
      if (base !== undefined && base !== 0) t.push(term(-base, vr(c, k)));
    }
    for (let p = 0; p < NP; p++)
      for (let k = 0; k < K; k++) {
        if (!hasV(c, p, k)) continue;
        const d = model.delta(c, nodes[p], k);
        if (d !== undefined && d !== 0) t.push(term(-d, vv(c, p, k)));
      }
    addCon("drivetime_" + c, t.join(" ") + " = 0");
  }

  const fixedVars = new Map<string, number>();
  const setFix = (vn: string, val: number) => { fixedVars.set(vn, val); };

  // willingness=always => z=1
  for (let c = 0; c < D; c++)
    if (cars[c].willingness === "always") setFix(vz(c), 1);

  // (6) fixed
  for (const f of input.fixed) {
    const i = model.memberIndex.get(f.memberId);
    const c = model.carIndex.get(f.driverId);
    if (i === undefined || c === undefined) continue;
    setFix(vy(i, c), 1);
    setFix(vz(c), 1);
  }

  // (17) locks. Resolvability is enforced up-front in validate(); here we only
  // pin the corresponding variables (skipping any that were pruned).
  for (const lk of input.locks) {
    const c = model.carIndex.get(lk.driverId);
    if (c === undefined) continue;
    setFix(vz(c), 1);
    if (lk.memberId !== undefined) {
      const i = model.memberIndex.get(lk.memberId);
      if (i !== undefined) {
        setFix(vy(i, c), 1);
        if (lk.nodeId !== undefined) {
          const p = nodeIndex.get(lk.nodeId);
          if (p !== undefined && i !== driverMemberIdx(c) && hasB(i, c, p)) setFix(vb(i, c, p), 1);
        }
      }
    } else if (lk.nodeId !== undefined) {
      const p = nodeIndex.get(lk.nodeId);
      if (p !== undefined && hasU(c, p)) setFix(vu(c, p), 1);
    }
    if (lk.routeId !== undefined) {
      const k = model.routeIndex.get(lk.routeId);
      if (k !== undefined && hasR(c, k)) setFix(vr(c, k), 1);
    }
  }

  // (15)(16) spread + earliest-departure (skip in provisional).
  // Use a TIGHT big-M derived from the start-time span so the LP relaxation is
  // strong and the MIP solves quickly.
  const startVals = members
    .map((m) => m.startMin)
    .filter((s): s is number => s !== null);
  const minStart = startVals.length > 0 ? Math.min(...startVals) : 0;
  const maxStart = startVals.length > 0 ? Math.max(...startVals) : 0;
  const spreadM = Math.max(1, maxStart - minStart);
  if (!provisional) {
    for (let c = 0; c < D; c++) {
      for (let i = 0; i < M; i++) {
        const s = members[i].startMin;
        if (s === null) continue;
        // smax_c >= s - spreadM(1 - y) ; smax bounded in [minStart, maxStart]
        addCon("smaxc_" + c + "_" + i, term(1, vsmax(c)) + " " + term(-spreadM, vy(i, c)) + " >= " + fmt(s - spreadM));
        // smin_c <= s + spreadM(1 - y)
        addCon("sminc_" + c + "_" + i, term(1, vsmin(c)) + " " + term(spreadM, vy(i, c)) + " <= " + fmt(s + spreadM));
      }
      addCon("spreaddef_" + c, term(1, vspread(c)) + " " + term(-1, vsmax(c)) + " " + term(1, vsmin(c)) + " >= 0");
    }
    // (16) earliest departure: smin_c - T_c - BigM z_c >= ed_c + B - BigM.
    // When z_c=1 this reduces to smin_c - T_c >= ed_c + B, i.e. every member's
    // start in car c must be >= ed_c + B + T_c. The z coefficient MUST be -BigM
    // so the row deactivates (holds trivially) ONLY when z_c=0; a +BigM here
    // would make the row always satisfied and silently ignore ed_c.
    for (let c = 0; c < D; c++) {
      const ed = cars[c].earliestDepMin;
      if (ed === null) continue;
      addCon("earlydep_" + c, term(1, vsmin(c)) + " " + term(-1, vT(c)) + " " + term(-BIG_M, vz(c)) + " >= " + fmt(ed - BIG_M + B));
    }
  }

  const lines: string[] = [];
  const bs = "\\";
  lines.push(bs + " Carpool MILP - generated");
  lines.push(bs + " Variables:");
  for (let i = 0; i < M; i++)
    for (let c = 0; c < D; c++)
      lines.push(bs + "   " + vy(i, c) + " = member[" + members[i].id + "] in car[" + cars[c].driverId + "]");
  for (let c = 0; c < D; c++)
    lines.push(bs + "   " + vz(c) + "   = car[" + cars[c].driverId + "] active");
  for (let c = 0; c < D; c++)
    for (let k = 0; k < K; k++)
      if (hasR(c, k)) lines.push(bs + "   " + vr(c, k) + " = car[" + cars[c].driverId + "] route[" + routes[k].id + "]");
  for (let p = 0; p < NP; p++)
    lines.push(bs + "   node[" + p + "] = " + nodes[p]);

  lines.push("Minimize");
  lines.push(" obj: " + objTerms.join(" "));
  lines.push("Subject To");
  for (const con of cons) lines.push(con);

  lines.push("Bounds");
  for (const [vn, val] of fixedVars) lines.push(" " + vn + " = " + val);
  for (let c = 0; c < D; c++) lines.push(" " + vT(c) + " >= 0");
  if (!provisional)
    for (let c = 0; c < D; c++) {
      lines.push(" " + vsmax(c) + " >= 0");
      lines.push(" " + vsmin(c) + " >= 0");
      lines.push(" " + vspread(c) + " >= 0");
    }

  lines.push("Binary");
  const bins: string[] = [];
  for (const vn of reg.y.values()) bins.push(vn);
  for (const vn of reg.z.values()) bins.push(vn);
  for (const vn of reg.r.values()) bins.push(vn);
  for (const vn of reg.b.values()) bins.push(vn);
  for (const vn of reg.u.values()) bins.push(vn);
  for (const vn of reg.v.values()) bins.push(vn);
  for (let i = 0; i < bins.length; i += 10) lines.push(" " + bins.slice(i, i + 10).join(" "));

  lines.push("End");

  return { lp: lines.join("\n"), registry: reg, model };
}

export function buildLpDetailed(input: SolveInput): BuildLpOutput {
  return buildLpFromModel(buildModel(input));
}

export function buildLp(input: SolveInput): string {
  return buildLpDetailed(input).lp;
}
