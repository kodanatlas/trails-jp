import { describe, it, expect } from "vitest";
import { planCreateSchema } from "../api/plan-schemas";

// 固定 UUID（zod .uuid() を通す形式的に正しい値）。
const U = {
  d1: "11111111-1111-4111-8111-111111111111",
  d2: "22222222-2222-4222-8222-222222222222",
  r1: "33333333-3333-4333-8333-333333333333",
  r2: "44444444-4444-4444-8444-444444444444",
  node: "55555555-5555-4555-8555-555555555555",
  route: "66666666-6666-4666-8666-666666666666",
};

const baseKpi = {
  totalDriveMin: 120,
  totalAccessMin: 30,
  maxSpreadMin: 45,
  carsUsed: 2,
};

const baseWeights = {
  drive: 1,
  spread: 1,
  access: 0.5,
  risk: 15,
  car: 60,
  soft: 20,
};

function carOf(driver: string, riders: string[]) {
  return {
    driverMemberId: driver,
    routeId: U.route,
    pickupNodeIds: [U.node],
    departureTime: "06:30",
    arrivalTime: "08:45",
    riders: riders.map((memberId) => ({
      memberId,
      nodeId: U.node,
      boardTime: "06:50",
      locked: false,
    })),
  };
}

function basePayload(over: Record<string, unknown> = {}) {
  return {
    actorName: "テスト操作者",
    kind: "outbound",
    status: "published",
    locks: [],
    weights: baseWeights,
    kpi: baseKpi,
    cars: [carOf(U.d1, [U.r1]), carOf(U.d2, [U.r2])],
    ...over,
  };
}

describe("planCreateSchema — 正常系", () => {
  it("accepts a valid published payload", () => {
    const res = planCreateSchema.safeParse(basePayload());
    expect(res.success).toBe(true);
  });

  it("accepts a draft with empty cars (作業途中の下書きは許容)", () => {
    const res = planCreateSchema.safeParse(
      basePayload({ status: "draft", cars: [] }),
    );
    expect(res.success).toBe(true);
  });
});

describe("planCreateSchema — 境界（レビュー指摘 #4 / #11）", () => {
  it("rejects published with empty cars (空の公開版が最新を上書きするのを防ぐ)", () => {
    const res = planCreateSchema.safeParse(basePayload({ cars: [] }));
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(
        res.error.issues.some((i) => i.message.includes("車がありません")),
      ).toBe(true);
    }
  });

  it("rejects duplicate driver across cars", () => {
    const res = planCreateSchema.safeParse(
      basePayload({ cars: [carOf(U.d1, [U.r1]), carOf(U.d1, [U.r2])] }),
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(
        res.error.issues.some((i) => i.message.includes("同じ運転手")),
      ).toBe(true);
    }
  });

  it("rejects the same member assigned to two cars", () => {
    const res = planCreateSchema.safeParse(
      basePayload({ cars: [carOf(U.d1, [U.r1]), carOf(U.d2, [U.r1])] }),
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(
        res.error.issues.some((i) => i.message.includes("複数の車")),
      ).toBe(true);
    }
  });

  it("rejects a driver who also appears as a rider in another car", () => {
    const res = planCreateSchema.safeParse(
      basePayload({ cars: [carOf(U.d1, [U.r1]), carOf(U.d2, [U.d1])] }),
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(
        res.error.issues.some((i) => i.message.includes("運転手が他の車")),
      ).toBe(true);
    }
  });

  it("rejects out-of-range kpi numbers (#6)", () => {
    const res = planCreateSchema.safeParse(
      basePayload({ kpi: { ...baseKpi, totalDriveMin: 1e308 } }),
    );
    expect(res.success).toBe(false);
  });

  it("rejects oversized recommendedDeparture jsonb (#6)", () => {
    const big = { note: "x".repeat(3000) };
    const cars = [{ ...carOf(U.d1, [U.r1]), recommendedDeparture: big }];
    const res = planCreateSchema.safeParse(basePayload({ cars }));
    expect(res.success).toBe(false);
  });

  it("accepts a reasonably-sized recommendedDeparture", () => {
    const ok = { normal: "06:30", avoidCongestion: "06:10" };
    const cars = [{ ...carOf(U.d1, [U.r1]), recommendedDeparture: ok }];
    const res = planCreateSchema.safeParse(basePayload({ cars }));
    expect(res.success).toBe(true);
  });
});
