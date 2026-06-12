import { describe, it, expect, beforeAll } from "vitest";
import highsLoader from "highs";
import { solveCarpool, buildLp } from "../solve";
import { makeSmall } from "../fixtures/small";
import type { HighsLike } from "../types";

let highs: HighsLike;
beforeAll(async () => { highs = (await highsLoader()) as unknown as HighsLike; });

describe("case3: hard pickup nodes", () => {
  it("never boards riders outside a car's hard nodes", () => {
    const input = makeSmall();
    input.cars[0].hardNodes = ["H"];
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("optimal");
    const car = res.cars.find((c) => c.driverId === "m1")!;
    for (const rider of car.riders) {
      if (rider.memberId === "m1") continue; // driver boards at own home
      expect(rider.nodeId).toBe("H");
    }
  });

  it("buildLp never lets a rider stop at a non-allowed node", () => {
    const input = makeSmall();
    input.cars[0].hardNodes = ["H"];
    const lp = buildLp(input);
    const lines = lp.split("\n");
    // resolve node index for A from the comment table
    const aLine = lines.find((l) => l.includes("node[") && l.trim().endsWith("= A"));
    expect(aLine).toBeDefined();
    const aIdx = aLine!.match(/node\[(\d+)\]/)![1];
    const uVar = "u_0_" + aIdx;
    // The stop variable for car0 at node A must not appear with a +/-1 coefficient
    // in any constraint row (it is pruned because A is not in hardNodes).
    const usedActively = lines.some(
      (l) => l.includes("+ 1 " + uVar) || l.includes("- 1 " + uVar),
    );
    expect(usedActively).toBe(false);
    // and it must not be declared as an active binary either
    const binIdx = lines.findIndex((l) => l === "Binary");
    const binText = lines.slice(binIdx + 1).join(" ");
    const declaredBinary = binText.split(/\s+/).includes(uVar);
    expect(declaredBinary).toBe(false);
  });
});
