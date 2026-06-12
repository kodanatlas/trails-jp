import { describe, it, expect, beforeAll } from "vitest";
import highsLoader from "highs";
import { solveCarpool, buildLp } from "../solve";
import { edScenario } from "../fixtures/scenarios";
import type { HighsLike } from "../types";

let highs: HighsLike;
beforeAll(async () => { highs = (await highsLoader()) as unknown as HighsLike; });

describe("case9: earliest departure (ed_c)", () => {
  it("keeps an early-start member out of a late-departure (ed) car", () => {
    const input = edScenario();
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("optimal");

    // The ed-car (driverLate, ed=480) must NOT carry earlyM (start 540), because
    // (16) requires every member's start there to be >= ed+B+T = 585.
    const lateCar = res.cars.find((c) => c.driverId === "driverLate");
    if (lateCar) {
      expect(lateCar.riders.some((r) => r.memberId === "earlyM")).toBe(false);
    }

    // earlyM must still be placed (in the fallback carMid).
    const earlyPlaced = res.cars.some((c) =>
      c.riders.some((r) => r.memberId === "earlyM"),
    );
    expect(earlyPlaced).toBe(true);

    // Everyone assigned exactly once.
    const assigned = res.cars.flatMap((c) => c.riders.map((r) => r.memberId));
    expect(new Set(assigned).size).toBe(input.members.length);
  });

  it("emits the (16) earliest-departure row with a -BigM (1440) z coefficient", () => {
    // Regression guard for the sign of constraint (16): the z_c coefficient MUST
    // be -BigM (1440). A +BigM would make the row trivially satisfied and ignore
    // ed_c entirely (the original blocker bug).
    const input = edScenario();
    const lp = buildLp(input);
    const lines = lp.split("\n");

    // earlydep rows are named "c<n>_earlydep_<carIndex>"; the ed car (driverLate)
    // is car index 1.
    const row = lines.find((l) => /c\d+_earlydep_1:/.test(l));
    expect(row).toBeDefined();
    // The corrected formulation subtracts BigM*z (i.e. "- 1440 z_1").
    expect(row!).toContain("- 1440 z_1");
    // And must NOT add it (the buggy "+ 1440 z_1").
    expect(row!).not.toContain("+ 1440 z_1");
  });
});
