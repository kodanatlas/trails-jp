import { describe, it, expect, beforeAll } from "vitest";
import highsLoader from "highs";
import { solveCarpool } from "../solve";
import { makeSmall } from "../fixtures/small";
import type { HighsLike } from "../types";

let highs: HighsLike;
beforeAll(async () => { highs = (await highsLoader()) as unknown as HighsLike; });

describe("case6: lock and re-optimize", () => {
  it("keeps the locked ride while re-placing others", () => {
    // First solve, then lock a specific rider->driver and re-solve.
    const base = makeSmall();
    const first = solveCarpool(base, highs);
    expect(first.status).toBe("optimal");

    // lock m7 to driver m5 (force a non-default placement)
    const locked = makeSmall({ locks: [{ memberId: "m7", driverId: "m5" }] });
    const res = solveCarpool(locked, highs);
    expect(res.status).toBe("optimal");
    const car = res.cars.find((c) => c.driverId === "m5")!;
    expect(car.riders.some((r) => r.memberId === "m7")).toBe(true);
    // everyone still assigned exactly once
    const assigned = res.cars.flatMap((c) => c.riders.map((r) => r.memberId));
    expect(new Set(assigned).size).toBe(base.members.length);
  });

  it("honors a node-level lock (member boards at the locked node)", () => {
    const input = makeSmall({ locks: [{ memberId: "m7", driverId: "m5", nodeId: "H" }] });
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("optimal");
    const car = res.cars.find((c) => c.driverId === "m5")!;
    const rider = car.riders.find((r) => r.memberId === "m7");
    expect(rider).toBeDefined();
    expect(rider!.nodeId).toBe("H");
  });
});
