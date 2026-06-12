import { describe, it, expect, beforeAll } from "vitest";
import highsLoader from "highs";
import { solveCarpool } from "../solve";
import { makeSmall } from "../fixtures/small";
import type { HighsLike } from "../types";

let highs: HighsLike;
beforeAll(async () => { highs = (await highsLoader()) as unknown as HighsLike; });

describe("case2: fixed assignments", () => {
  it("honors a fixed member->driver assignment", () => {
    const input = makeSmall({ fixed: [{ memberId: "m12", driverId: "m5" }] });
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("optimal");
    const car = res.cars.find((c) => c.driverId === "m5");
    expect(car).toBeDefined();
    expect(car!.riders.some((r) => r.memberId === "m12")).toBe(true);
  });

  it("reports a Japanese error when fixed driver has no car", () => {
    const input = makeSmall({ fixed: [{ memberId: "m2", driverId: "ghost" }] });
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("error");
    expect(res.validationErrors.some((e) => e.includes("ghost") && e.includes("車がありません"))).toBe(true);
  });

  it("reports a Japanese error when fixed exceeds capacity", () => {
    // m1 car capacity 4; fix 5 members to it
    const input = makeSmall({
      fixed: [
        { memberId: "m2", driverId: "m1" },
        { memberId: "m3", driverId: "m1" },
        { memberId: "m4", driverId: "m1" },
        { memberId: "m6", driverId: "m1" },
        { memberId: "m7", driverId: "m1" },
      ],
    });
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("error");
    expect(res.validationErrors.some((e) => e.includes("定員") && e.includes("超え"))).toBe(true);
  });
});
