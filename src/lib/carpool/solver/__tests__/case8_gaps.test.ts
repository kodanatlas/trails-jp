import { describe, it, expect, beforeAll } from "vitest";
import highsLoader from "highs";
import { solveCarpool } from "../solve";
import { gapScenario } from "../fixtures/scenarios";
import type { HighsLike } from "../types";

let highs: HighsLike;
beforeAll(async () => { highs = (await highsLoader()) as unknown as HighsLike; });

describe("case8: travel matrix gaps", () => {
  it("enumerates missing matrix pairs in validationErrors", () => {
    const input = gapScenario();
    const res = solveCarpool(input, highs);
    expect(res.status).toBe("error");
    // rider homed at B cannot reach pickup hub H (transit B>H deleted) and the
    // home-area boarding to A is also unreachable -> isolated.
    const hasGapMsg = res.validationErrors.some(
      (e) => e.includes("移動時間が未入力") && e.includes("B") && e.includes("transit"),
    );
    const hasIsolated = res.validationErrors.some((e) => e.includes("乗車可能地点がありません"));
    expect(hasGapMsg || hasIsolated).toBe(true);
    expect(res.validationErrors.length).toBeGreaterThan(0);
  });
});
