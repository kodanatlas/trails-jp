import { describe, it, expect, beforeAll } from "vitest";
import highsLoader from "highs";
import { solveCarpool, validate } from "../solve";
import { makeSmall } from "../fixtures/small";
import type { HighsLike } from "../types";

let highs: HighsLike;
beforeAll(async () => { highs = (await highsLoader()) as unknown as HighsLike; });

describe("case13: lock resolvability is validated, not silently dropped", () => {
  it("errors when a lock node is outside the car's hard-specified nodes", () => {
    const input = makeSmall();
    // restrict m1's car to hub H, then try to lock m7 onto m1 at node A.
    input.cars[0].hardNodes = ["H"];
    input.locks = [{ memberId: "m7", driverId: "m1", nodeId: "A" }];
    const errs = validate(input);
    expect(
      errs.some((e) => e.includes("ロックが適用できません") && e.includes("hard指定外")),
    ).toBe(true);
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("error");
  });

  it("errors when the same member is locked to two different drivers", () => {
    const input = makeSmall();
    input.locks = [
      { memberId: "m7", driverId: "m1" },
      { memberId: "m7", driverId: "m5" },
    ];
    const errs = validate(input);
    expect(
      errs.some((e) => e.includes("複数の車") && e.includes("m7")),
    ).toBe(true);
  });

  it("errors when a lock targets a non-existent driver", () => {
    const input = makeSmall();
    input.locks = [{ memberId: "m7", driverId: "ghost" }];
    const errs = validate(input);
    expect(
      errs.some((e) => e.includes("ロックが適用できません") && e.includes("ghost")),
    ).toBe(true);
  });

  it("still honors a valid node-level lock (no false positive)", () => {
    const input = makeSmall({ locks: [{ memberId: "m7", driverId: "m5", nodeId: "H" }] });
    const errs = validate(input);
    expect(errs.length).toBe(0);
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("optimal");
    const car = res.cars.find((c) => c.driverId === "m5")!;
    expect(car.riders.find((r) => r.memberId === "m7")!.nodeId).toBe("H");
  });
});
