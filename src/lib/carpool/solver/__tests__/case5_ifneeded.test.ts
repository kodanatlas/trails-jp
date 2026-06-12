import { describe, it, expect, beforeAll } from "vitest";
import highsLoader from "highs";
import { solveCarpool } from "../solve";
import { ifNeededScenario } from "../fixtures/scenarios";
import type { HighsLike } from "../types";

let highs: HighsLike;
beforeAll(async () => { highs = (await highsLoader()) as unknown as HighsLike; });

describe("case5: if_needed activation", () => {
  it("does NOT activate the if_needed car when always capacity suffices", () => {
    // 3 members, always car cap 4 -> if_needed (u1) should stay off.
    const input = ifNeededScenario(3, 4);
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("optimal");
    const ifNeededCar = res.cars.find((c) => c.driverId === "u1");
    expect(ifNeededCar).toBeUndefined();
    expect(res.kpi.carsUsed).toBe(1);
  });

  it("activates the if_needed car only when always capacity is insufficient", () => {
    // 6 members, always car cap 4 -> need if_needed car too.
    const input = ifNeededScenario(6, 4);
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("optimal");
    const ifNeededCar = res.cars.find((c) => c.driverId === "u1");
    expect(ifNeededCar).toBeDefined();
    expect(res.kpi.carsUsed).toBe(2);
  });
});
