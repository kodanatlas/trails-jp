import { describe, it, expect, beforeAll } from "vitest";
import highsLoader from "highs";
import { solveCarpool, buildLp } from "../solve";
import { noDeltaScenario } from "../fixtures/scenarios";
import type { HighsLike } from "../types";

let highs: HighsLike;
beforeAll(async () => { highs = (await highsLoader()) as unknown as HighsLike; });

describe("case11: missing-δ stop/route cannot be co-selected (12b)", () => {
  it("emits a nodelta constraint forbidding u[c,p] + r[c,k] together", () => {
    const input = noDeltaScenario();
    const lp = buildLp(input);
    // there must be at least one "nodelta" row of the form u_.. + r_.. <= 1
    const hasNodelta = lp
      .split("\n")
      .some((l) => /nodelta_\d+_\d+_\d+:/.test(l) && l.includes("<= 1"));
    expect(hasNodelta).toBe(true);
  });

  it("never carries a rider via a route that lacks that pickup node's δ", () => {
    const input = noDeltaScenario();
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("optimal");

    const car = res.cars.find((c) => c.driverId === "d1");
    expect(car).toBeDefined();
    // r1 (home P) must be carried, and it can only board at P.
    const carriesR1 = car!.riders.some((r) => r.memberId === "r1");
    expect(carriesR1).toBe(true);
    const r1 = car!.riders.find((r) => r.memberId === "r1");
    expect(r1!.nodeId).toBe("P");

    // Because P has no δ on "rBad", picking up at P forces the route to "rGood".
    // Selecting "rBad" would mean detouring to P for free, which is impossible.
    expect(car!.routeId).toBe("rGood");
  });
});
