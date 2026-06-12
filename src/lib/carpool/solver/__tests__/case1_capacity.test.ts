import { describe, it, expect, beforeAll } from "vitest";
import highsLoader from "highs";
import { solveCarpool } from "../solve";
import { makeSmall } from "../fixtures/small";
import { makeLarge } from "../fixtures/large";
import type { HighsLike } from "../types";

let highs: HighsLike;
beforeAll(async () => {
  highs = (await highsLoader()) as unknown as HighsLike;
});

describe("case1: capacity", () => {
  it("never exceeds capacity on small fixture", () => {
    const input = makeSmall();
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("optimal");
    const capByDriver = new Map(input.cars.map((c) => [c.driverId, c.capacity]));
    for (const car of res.cars) {
      const cap = capByDriver.get(car.driverId)!;
      expect(car.riders.length).toBeLessThanOrEqual(cap);
    }
    const assigned = res.cars.flatMap((c) => c.riders.map((r) => r.memberId));
    expect(new Set(assigned).size).toBe(input.members.length);
  });

  it(
    "never exceeds capacity on large fixture",
    { timeout: 30000 },
    () => {
      const input = makeLarge();
      const res = solveCarpool(input, highs, { timeLimitSec: 2, mipRelGap: 0.05 });
      expect(res.status).toBe("optimal");
      const capByDriver = new Map(input.cars.map((c) => [c.driverId, c.capacity]));
      for (const car of res.cars) {
        const cap = capByDriver.get(car.driverId)!;
        expect(car.riders.length).toBeLessThanOrEqual(cap);
      }
      const assigned = res.cars.flatMap((c) => c.riders.map((r) => r.memberId));
      expect(new Set(assigned).size).toBe(input.members.length);
    },
  );
});
