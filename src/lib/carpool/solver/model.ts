// Derives the index sets and parameter lookups shared by validate.ts and lp.ts.
// Pure functions; no solver dependency.

import type { SolveInput, Member, Car, Route } from "./types";

export interface Model {
  input: SolveInput;
  members: Member[];
  cars: Car[];
  routes: Route[];
  memberIndex: Map<string, number>; // memberId -> i
  carIndex: Map<string, number>; // driverId -> c
  routeIndex: Map<string, number>; // routeId -> k
  P: string[]; // pickupNodes ∪ all member home areas (deduped)
  allowed: (c: number) => string[]; // allowed pickup nodes for car c
  pref: (c: number) => Set<string>; // soft-preferred nodes for car c
  homeOf: (i: number) => string; // member home node
  carHome: (c: number) => string; // driver home node
  carDriverMemberIndex: (c: number) => number; // member index of the driver
  carTravel: (from: string, to: string) => number | undefined; // travel.car
  transit: (from: string, to: string) => number | undefined; // travel.transit
  routeTime: (k: number, node: string) => number | undefined; // rt(k,node)
  access: (i: number, p: string) => number | undefined; // a(i,p)
  baseCK: (c: number, k: number) => number | undefined; // base(c,k)=rt(k,home_c)
  delta: (c: number, p: string, k: number) => number | undefined; // δ(c,p,k)
}

export function buildModel(input: SolveInput): Model {
  const members = input.members;
  const cars = input.cars;
  const routes = input.routes;

  const memberIndex = new Map<string, number>();
  members.forEach((m, i) => memberIndex.set(m.id, i));
  const carIndex = new Map<string, number>();
  cars.forEach((c, j) => carIndex.set(c.driverId, j));
  const routeIndex = new Map<string, number>();
  routes.forEach((r, k) => routeIndex.set(r.id, k));

  // P = pickupNodes ∪ all member home areas
  const pSet = new Set<string>(input.pickupNodes);
  for (const m of members) pSet.add(m.homeNodeId);
  const P = Array.from(pSet);

  const homeOf = (i: number) => members[i].homeNodeId;
  const carHome = (c: number) => {
    const driver = cars[c].driverId;
    const mi = memberIndex.get(driver);
    return mi !== undefined ? members[mi].homeNodeId : "";
  };
  const carDriverMemberIndex = (c: number) => {
    const mi = memberIndex.get(cars[c].driverId);
    return mi === undefined ? -1 : mi;
  };

  const carTravel = (from: string, to: string): number | undefined => {
    if (from === to) return 0;
    return input.travel.car[`${from}>${to}`];
  };
  const transit = (from: string, to: string): number | undefined => {
    if (from === to) return 0;
    return input.travel.transit[`${from}>${to}`];
  };

  const routeTime = (k: number, node: string): number | undefined =>
    routes[k].minutesToVenue[node];

  // a(i,p): p == home of i -> 0; else transit[home_i > p]
  const access = (i: number, p: string): number | undefined => {
    if (homeOf(i) === p) return 0;
    return transit(homeOf(i), p);
  };

  const baseCK = (c: number, k: number): number | undefined =>
    routeTime(k, carHome(c));

  // δ(c,p,k)=max(0, car(home_c,p)+rt(k,p)−base(c,k)); undefined if any input missing
  const delta = (c: number, p: string, k: number): number | undefined => {
    const home = carHome(c);
    const cp = carTravel(home, p);
    const rtp = routeTime(k, p);
    const base = baseCK(c, k);
    if (cp === undefined || rtp === undefined || base === undefined)
      return undefined;
    return Math.max(0, cp + rtp - base);
  };

  const allowed = (c: number): string[] => {
    const hn = cars[c].hardNodes;
    if (hn && hn.length > 0) return hn;
    return P;
  };
  const pref = (c: number): Set<string> => new Set(cars[c].softNodes ?? []);

  return {
    input,
    members,
    cars,
    routes,
    memberIndex,
    carIndex,
    routeIndex,
    P,
    allowed,
    pref,
    homeOf,
    carHome,
    carDriverMemberIndex,
    carTravel,
    transit,
    routeTime,
    access,
    baseCK,
    delta,
  };
}
