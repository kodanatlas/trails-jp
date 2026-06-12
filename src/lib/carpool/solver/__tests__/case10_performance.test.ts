import { describe, it, expect, beforeAll } from "vitest";
import highsLoader from "highs";
import { solveCarpool } from "../solve";
import { makeLarge } from "../fixtures/large";
import type { HighsLike } from "../types";

let highs: HighsLike;
beforeAll(async () => { highs = (await highsLoader()) as unknown as HighsLike; });

describe("case10: performance", () => {
  it(
    "solves 30 members / 8 cars / 15 nodes / 3 routes within 5 seconds",
    { timeout: 30000 },
    () => {
      const input = makeLarge();
      const t0 = Date.now();
      const res = solveCarpool(input, highs, { timeLimitSec: 2, mipRelGap: 0.05 });
      const elapsedMs = Date.now() - t0;
      // eslint-disable-next-line no-console
      console.log("PERF_MS:", elapsedMs);

      expect(res.status).toBe("optimal");
      expect(elapsedMs).toBeLessThan(5000);

      // returned a fully feasible assignment
      const assigned = res.cars.flatMap((c) => c.riders.map((r) => r.memberId));
      expect(new Set(assigned).size).toBe(input.members.length);
      const capByDriver = new Map(input.cars.map((c) => [c.driverId, c.capacity]));
      for (const car of res.cars) {
        expect(car.riders.length).toBeLessThanOrEqual(capByDriver.get(car.driverId)!);
      }
    },
  );
});
