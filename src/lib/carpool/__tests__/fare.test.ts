import { describe, it, expect } from "vitest";
import { calcFare } from "../fare";
import type { FareSettings, FareRoute } from "../fare";

// ---------------------------------------------------------------------------
// フィクスチャ
// ---------------------------------------------------------------------------

const baseSettings: FareSettings = {
  fuel_price_per_liter: 170,
  fuel_efficiency_km_per_liter: 15,
  driver_coefficient: 1,
  rounding_unit_yen: 100,
};

const route100km: FareRoute = { tollYen: 2420, distanceKm: 100 };

// ---------------------------------------------------------------------------
// 正常系: 基本計算
// ---------------------------------------------------------------------------

describe("calcFare", () => {
  it("基本ケース: 2人同乗・運転手係数1", () => {
    // cost = 2420*2 + 100*2/15*170 = 4840 + 2266.67 ≈ round → 2267
    // total = 4840 + 2267 = 7107
    // divisor = 2 + 1 = 3
    // unit = 7107/3 = 2369
    // perRider = ceil(2369/100)*100 = 2400
    // driver = 7107 - 2400*2 = 2307
    const result = calcFare(route100km, 2, baseSettings);
    expect(result).not.toBeNull();
    expect(result!.riderCount).toBe(2);
    expect(result!.tollRoundYen).toBe(4840);
    expect(result!.fuelRoundYen).toBe(2267);
    expect(result!.totalYen).toBe(7107);
    expect(result!.perRiderYen).toBe(2400);
    expect(result!.driverYen).toBe(7107 - 2400 * 2);
    // 端数確認: driver < perRider（端数吸収）
    expect(result!.driverYen).toBeLessThanOrEqual(result!.perRiderYen);
  });

  it("運転手係数 0: 運転手負担なし → 全額同乗者で割る", () => {
    const settings: FareSettings = { ...baseSettings, driver_coefficient: 0 };
    // divisor = 2 + 0 = 2
    // unit = 7107/2 = 3553.5
    // perRider = ceil(3553.5/100)*100 = 3600
    // driver = 7107 - 3600*2 = -93 (端数として運転手がマイナス負担 = 差し引き)
    const result = calcFare(route100km, 2, settings);
    expect(result).not.toBeNull();
    expect(result!.perRiderYen).toBe(3600);
    expect(result!.driverYen).toBe(7107 - 3600 * 2);
  });

  it("運転手係数 0.5: 半額負担", () => {
    const settings: FareSettings = { ...baseSettings, driver_coefficient: 0.5 };
    // divisor = 2 + 0.5 = 2.5
    // unit = 7107/2.5 = 2842.8
    // perRider = ceil(2842.8/100)*100 = 2900
    // driver = 7107 - 2900*2 = 1307
    const result = calcFare(route100km, 2, settings);
    expect(result).not.toBeNull();
    expect(result!.perRiderYen).toBe(2900);
    expect(result!.driverYen).toBe(7107 - 2900 * 2);
  });

  it("同乗者 0 人: perRiderYen は 0、運転手が全額", () => {
    const result = calcFare(route100km, 0, baseSettings);
    expect(result).not.toBeNull();
    expect(result!.perRiderYen).toBe(0);
    expect(result!.driverYen).toBe(result!.totalYen);
  });

  it("同乗者 0 人・運転手係数 0 → 分母 0: 運転手が全額", () => {
    const settings: FareSettings = { ...baseSettings, driver_coefficient: 0 };
    const result = calcFare(route100km, 0, settings);
    expect(result).not.toBeNull();
    expect(result!.perRiderYen).toBe(0);
    expect(result!.driverYen).toBe(result!.totalYen);
  });

  it("丸め単位 500円", () => {
    const settings: FareSettings = { ...baseSettings, rounding_unit_yen: 500 };
    const result = calcFare(route100km, 2, settings);
    expect(result).not.toBeNull();
    // perRiderYen は 500 の倍数
    expect(result!.perRiderYen % 500).toBe(0);
  });

  it("distanceKm = 0 → null を返す（計算不能）", () => {
    const result = calcFare({ tollYen: 1000, distanceKm: 0 }, 2, baseSettings);
    expect(result).toBeNull();
  });

  it("fuel_price_per_liter 未設定 → null を返す", () => {
    const settings: FareSettings = { ...baseSettings, fuel_price_per_liter: undefined };
    const result = calcFare(route100km, 2, settings);
    expect(result).toBeNull();
  });

  it("fuel_efficiency_km_per_liter 未設定 → null を返す", () => {
    const settings: FareSettings = {
      ...baseSettings,
      fuel_efficiency_km_per_liter: undefined,
    };
    const result = calcFare(route100km, 2, settings);
    expect(result).toBeNull();
  });

  it("高速代ゼロ（無料道路）でも燃料代は計算できる", () => {
    const route: FareRoute = { tollYen: 0, distanceKm: 60 };
    const result = calcFare(route, 1, baseSettings);
    expect(result).not.toBeNull();
    expect(result!.tollRoundYen).toBe(0);
    expect(result!.fuelRoundYen).toBeGreaterThan(0);
  });
});
