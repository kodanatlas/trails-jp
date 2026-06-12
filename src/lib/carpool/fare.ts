/**
 * fare.ts — 割り勘計算（純粋関数）
 *
 * 仕様: 03_最適化モデル.md §7-3
 * cost_c = route.tollYen×2 + route.distanceKm×2 ÷ 燃費 × 燃料単価
 * 分担 = cost_c ÷ (同乗者数 + 運転手係数)
 * 同乗者: rounding_unit_yen の切り上げ、端数は運転手が吸収
 */

/** club.settings から読み出す設定値。 */
export interface FareSettings {
  fuel_price_per_liter?: number | null;
  fuel_efficiency_km_per_liter?: number | null;
  driver_coefficient?: 0 | 0.5 | 1 | null;
  rounding_unit_yen?: number | null;
}

/** ルートから使う最小情報。 */
export interface FareRoute {
  tollYen: number;
  distanceKm: number;
}

/** 割り勘計算結果。 */
export interface FareResult {
  totalYen: number;
  tollRoundYen: number;
  fuelRoundYen: number;
  perRiderYen: number;
  driverYen: number;
  riderCount: number;
}

/**
 * 割り勘を計算する。
 * @returns FareResult、または計算不能（distanceKm=0 / 燃費設定欠落）なら null
 */
export function calcFare(
  route: FareRoute,
  riderCount: number,
  settings: FareSettings,
): FareResult | null {
  const {
    fuel_price_per_liter,
    fuel_efficiency_km_per_liter,
    driver_coefficient,
    rounding_unit_yen,
  } = settings;

  if (!fuel_price_per_liter || !fuel_efficiency_km_per_liter || route.distanceKm <= 0) {
    return null;
  }

  const driverCoeff: number = driver_coefficient ?? 1;
  const roundingUnit: number = rounding_unit_yen ?? 100;

  const tollRoundYen = route.tollYen * 2;
  const fuelYen = (route.distanceKm * 2 * fuel_price_per_liter) / fuel_efficiency_km_per_liter;
  const fuelRoundYen = Math.round(fuelYen);
  const totalYen = tollRoundYen + fuelRoundYen;

  const divisor = riderCount + driverCoeff;

  if (divisor <= 0) {
    return { totalYen, tollRoundYen, fuelRoundYen, perRiderYen: 0, driverYen: totalYen, riderCount };
  }

  const unitYen = totalYen / divisor;
  const perRiderYen =
    riderCount > 0 ? Math.ceil(unitYen / roundingUnit) * roundingUnit : 0;
  const driverYen = totalYen - perRiderYen * riderCount;

  return { totalYen, tollRoundYen, fuelRoundYen, perRiderYen, driverYen, riderCount };
}
