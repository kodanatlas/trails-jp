import { describe, it, expect, beforeAll } from "vitest";
import highsLoader from "highs";
import { solveCarpool } from "../solve";
import { spreadScenario } from "../fixtures/scenarios";
import type { HighsLike } from "../types";

let highs: HighsLike;
beforeAll(async () => { highs = (await highsLoader()) as unknown as HighsLike; });

describe("case4: start-time spread", () => {
  it("groups same-start members together when w_spread dominates", () => {
    const input = spreadScenario(1000);
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("optimal");
    // each car should hold members with identical start times (spread 0)
    const startOf = new Map(input.members.map((m) => [m.id, m.startMin]));
    for (const car of res.cars) {
      const starts = car.riders.map((r) => startOf.get(r.memberId));
      const uniq = new Set(starts);
      expect(uniq.size).toBe(1); // homogeneous start group
      expect(car.spreadMin).toBe(0);
    }
    expect(res.kpi.maxSpreadMin).toBe(0);
  });
});
