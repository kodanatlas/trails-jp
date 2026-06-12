import { describe, it, expect } from "vitest";
import { recomputeBoardCars } from "../board-kpi";
import { DEFAULT_WEIGHTS, DEFAULT_OPTIONS } from "../solver/types";
import type { SolveInput, ResultCar } from "../solver/types";

/**
 * 小型フィクスチャ:
 *   d1: 自宅 A, ST 10:00(600)
 *   r1: 自宅 B, ST 10:30(630)
 *   r2: 自宅 C, ST 11:00(660)
 *   route k1: A→会場 90 / B→会場 100 / C→会場 80 / X→会場 85
 *   car:  A>B 15, A>C 20, A>X 10
 *   transit: B>X 12, C>X 18
 */
function makeInput(): SolveInput {
  return {
    members: [
      { id: "d1", startMin: 600, homeNodeId: "A" },
      { id: "r1", startMin: 630, homeNodeId: "B" },
      { id: "r2", startMin: 660, homeNodeId: "C" },
    ],
    cars: [
      {
        driverId: "d1",
        capacity: 3,
        willingness: "always",
        earliestDepMin: null,
        hardNodes: null,
        softNodes: [],
      },
    ],
    routes: [
      { id: "k1", riskScore: 0, minutesToVenue: { A: 90, B: 100, C: 80, X: 85 } },
    ],
    pickupNodes: ["X"],
    travel: {
      car: { "A>B": 15, "A>C": 20, "A>X": 10 },
      transit: { "B>X": 12, "C>X": 18 },
    },
    fixed: [],
    locks: [],
    weights: { ...DEFAULT_WEIGHTS },
    options: { ...DEFAULT_OPTIONS },
  };
}

function carOf(riders: { memberId: string; nodeId: string }[]): ResultCar {
  // driveMin / spreadMin は意図的にデタラメ（再計算で上書きされることを確認する）。
  return { driverId: "d1", routeId: "k1", riders, driveMin: 9999, spreadMin: 9999 };
}

describe("recomputeBoardCars", () => {
  it("recomputes driveMin as base + Σδ (rider boards at own home)", () => {
    const input = makeInput();
    const cars = [
      carOf([
        { memberId: "d1", nodeId: "A" },
        { memberId: "r1", nodeId: "B" },
      ]),
    ];
    const { cars: rebuilt, kpi, incomplete } = recomputeBoardCars(input, cars);
    // base=90, δ(B)=max(0, 15+100−90)=25 → 115
    expect(rebuilt[0].driveMin).toBe(115);
    // spread = 630−600 = 30
    expect(rebuilt[0].spreadMin).toBe(30);
    expect(kpi.totalDriveMin).toBe(115);
    expect(kpi.maxSpreadMin).toBe(30);
    expect(kpi.carsUsed).toBe(1);
    // r1 は自宅乗車 → アクセス 0
    expect(kpi.totalAccessMin).toBe(0);
    expect(incomplete).toBe(false);
  });

  it("recomputes access time when a rider boards at a pickup node", () => {
    const input = makeInput();
    const cars = [
      carOf([
        { memberId: "d1", nodeId: "A" },
        { memberId: "r1", nodeId: "X" },
      ]),
    ];
    const { cars: rebuilt, kpi } = recomputeBoardCars(input, cars);
    // base=90, δ(X)=max(0, 10+85−90)=5 → 95
    expect(rebuilt[0].driveMin).toBe(95);
    // r1 のアクセス: transit B>X = 12
    expect(kpi.totalAccessMin).toBe(12);
  });

  it("treats two riders at the same node as one stop", () => {
    const input = makeInput();
    const cars = [
      carOf([
        { memberId: "d1", nodeId: "A" },
        { memberId: "r1", nodeId: "X" },
        { memberId: "r2", nodeId: "X" },
      ]),
    ];
    const { cars: rebuilt, kpi } = recomputeBoardCars(input, cars);
    // δ(X) は1回だけ加算 → 95
    expect(rebuilt[0].driveMin).toBe(95);
    // アクセス: r1 12 + r2 18 = 30 / spread = 660−600 = 60
    expect(kpi.totalAccessMin).toBe(30);
    expect(rebuilt[0].spreadMin).toBe(60);
  });

  it("flags incomplete when a travel leg is missing (unknown node)", () => {
    const input = makeInput();
    const cars = [
      carOf([
        { memberId: "d1", nodeId: "A" },
        { memberId: "r1", nodeId: "Y" }, // Y はマトリクス・route_times に無い
      ]),
    ];
    const { cars: rebuilt, incomplete } = recomputeBoardCars(input, cars);
    expect(incomplete).toBe(true);
    // 欠損 δ は 0 扱い → base のみ
    expect(rebuilt[0].driveMin).toBe(90);
  });
});
