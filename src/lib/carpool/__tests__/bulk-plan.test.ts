import { describe, it, expect } from "vitest";
import { planBulkParticipations } from "../bulk-plan";

interface Row {
  memberId: string;
  className: string | null;
}

const r = (memberId: string, className: string | null = null): Row => ({
  memberId,
  className,
});

describe("planBulkParticipations (pure)", () => {
  it("inserts entries whose member has no existing participation", () => {
    const plan = planBulkParticipations(
      [r("a"), r("b"), r("c")],
      new Set<string>(),
    );
    expect(plan.toInsert.map((x) => x.memberId)).toEqual(["a", "b", "c"]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips entries whose member already has a participation (no role overwrite)", () => {
    const plan = planBulkParticipations(
      [r("a"), r("b"), r("c")],
      new Set<string>(["b"]),
    );
    expect(plan.toInsert.map((x) => x.memberId)).toEqual(["a", "c"]);
    expect(plan.skipped.map((x) => x.memberId)).toEqual(["b"]);
  });

  it("skips all when every member already participates", () => {
    const plan = planBulkParticipations(
      [r("a"), r("b")],
      new Set<string>(["a", "b"]),
    );
    expect(plan.toInsert).toEqual([]);
    expect(plan.skipped.map((x) => x.memberId)).toEqual(["a", "b"]);
  });

  it("dedupes repeated memberIds within the batch (first wins)", () => {
    const plan = planBulkParticipations(
      [r("a", "M21A"), r("a", "M35A"), r("b")],
      new Set<string>(),
    );
    // a は 1 件のみ（先勝ち = className M21A）。
    expect(plan.toInsert.map((x) => x.memberId)).toEqual(["a", "b"]);
    expect(plan.toInsert[0].className).toBe("M21A");
  });

  it("a duplicate that is also existing goes to skipped once", () => {
    const plan = planBulkParticipations(
      [r("a"), r("a")],
      new Set<string>(["a"]),
    );
    expect(plan.toInsert).toEqual([]);
    expect(plan.skipped.map((x) => x.memberId)).toEqual(["a"]);
  });

  it("preserves className on inserted rows", () => {
    const plan = planBulkParticipations([r("a", "W21A")], new Set<string>());
    expect(plan.toInsert[0].className).toBe("W21A");
  });

  it("handles an empty input", () => {
    const plan = planBulkParticipations([], new Set<string>());
    expect(plan.toInsert).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });
});
