import { describe, it, expect, beforeAll } from "vitest";
import highsLoader from "highs";
import { solveCarpool, validate } from "../solve";
import { makeSmall } from "../fixtures/small";
import type { HighsLike } from "../types";

let highs: HighsLike;
beforeAll(async () => { highs = (await highsLoader()) as unknown as HighsLike; });

// m1's car has capacity 4; capacity counts the driver's own seat, so at most
// 3 *additional* fixed riders fit (cnt + 1 <= capacity).
describe("case12: confirmed-assignment capacity counts the driver seat", () => {
  it("accepts exactly capacity-1 fixed riders (cnt + 1 == capacity)", () => {
    const input = makeSmall({
      fixed: [
        { memberId: "m2", driverId: "m1" },
        { memberId: "m3", driverId: "m1" },
        { memberId: "m4", driverId: "m1" }, // 3 fixed + driver = 4 == capacity
      ],
    });
    const errs = validate(input);
    expect(errs.some((e) => e.includes("定員") && e.includes("超え"))).toBe(false);
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("optimal");
  });

  it("rejects capacity fixed riders (cnt + 1 > capacity)", () => {
    const input = makeSmall({
      fixed: [
        { memberId: "m2", driverId: "m1" },
        { memberId: "m3", driverId: "m1" },
        { memberId: "m4", driverId: "m1" },
        { memberId: "m6", driverId: "m1" }, // 4 fixed + driver = 5 > capacity 4
      ],
    });
    const errs = validate(input);
    expect(errs.some((e) => e.includes("定員") && e.includes("超え"))).toBe(true);
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("error");
  });
});
