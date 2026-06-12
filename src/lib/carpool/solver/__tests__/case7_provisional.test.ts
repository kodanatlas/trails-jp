import { describe, it, expect, beforeAll } from "vitest";
import highsLoader from "highs";
import { solveCarpool, buildLp } from "../solve";
import { makeSmall } from "../fixtures/small";
import type { HighsLike } from "../types";

let highs: HighsLike;
beforeAll(async () => { highs = (await highsLoader()) as unknown as HighsLike; });

describe("case7: provisional mode", () => {
  it("solves with start=null members and no spread constraints", () => {
    const input = makeSmall({ provisional: true });
    // null out all start times
    for (const m of input.members) m.startMin = null;
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("optimal");
    expect(res.kpi.maxSpreadMin).toBe(0);
    const assigned = res.cars.flatMap((c) => c.riders.map((r) => r.memberId));
    expect(new Set(assigned).size).toBe(input.members.length);
  });

  it("buildLp omits spread variables in provisional mode", () => {
    const input = makeSmall({ provisional: true });
    for (const m of input.members) m.startMin = null;
    const lp = buildLp(input);
    expect(lp.includes("spread_")).toBe(false);
    expect(lp.includes("smax_")).toBe(false);
    expect(lp.includes("smin_")).toBe(false);
  });
});
