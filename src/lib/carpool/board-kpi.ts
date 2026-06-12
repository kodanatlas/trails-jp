/**
 * 手動移動後の盤面 KPI 再計算（純粋関数）。
 *
 * ボード上でチップを手動移動すると、ソルバが返した driveMin / spreadMin / kpi は
 * 盤面と食い違う。再最適化せずとも「盤面と整合する値」を表示・保存できるよう、
 * ソルバと同じモデル定義（base + Σδ の加法近似 / スタート時刻スプレッド /
 * アクセス時間）でクライアント側再計算する。
 *
 * 走行時間はソルバと同じ加法近似（03 §2「近似の明示」）なので、最適解の厳密値と
 * 一致する。マトリクス欠損で δ が引けない区間は 0 扱いにし `incomplete=true` を
 * 返す（UI は「概算」表示にする）。
 */

import { buildModel } from "./solver/model";
import { computeKpi } from "./solver/postprocess";
import type { SolveInput, ResultCar, Kpi } from "./solver/types";

export interface RecomputeBoardResult {
  /** driveMin / spreadMin を盤面の割当から再計算した cars。 */
  cars: ResultCar[];
  /** 再計算した KPI（totalDrive / totalAccess / maxSpread / carsUsed）。 */
  kpi: Kpi;
  /** マトリクス欠損等で一部の値が概算（0 扱い）になった場合 true。 */
  incomplete: boolean;
}

/**
 * 盤面の cars（手動移動を反映済み）から driveMin / spreadMin / KPI を再計算する。
 * `input` は直前の求解に使った SolveInput（モデル導出関数の出所）。
 */
export function recomputeBoardCars(
  input: SolveInput,
  cars: ResultCar[],
): RecomputeBoardResult {
  const model = buildModel(input);
  let incomplete = false;

  const rebuilt: ResultCar[] = cars.map((car) => {
    // spread: 車内メンバーのスタート時刻 max−min（postprocess.extractCars と同じ定義）。
    const starts = car.riders
      .map((r) => {
        const i = model.memberIndex.get(r.memberId);
        return i === undefined ? null : model.members[i].startMin;
      })
      .filter((s): s is number => s !== null);
    const spreadMin =
      starts.length > 0 ? Math.max(...starts) - Math.min(...starts) : 0;

    const c = model.carIndex.get(car.driverId);
    const k = model.routeIndex.get(car.routeId);
    if (c === undefined || k === undefined) {
      incomplete = true;
      return { ...car, spreadMin };
    }
    const base = model.baseCK(c, k);
    if (base === undefined) {
      incomplete = true;
      return { ...car, spreadMin };
    }

    // 立寄りノード = 運転手以外の rider の乗車地点（重複排除）。
    const driverIdx = model.carDriverMemberIndex(c);
    const stopNodes = new Set<string>();
    for (const r of car.riders) {
      const i = model.memberIndex.get(r.memberId);
      if (i !== undefined && i === driverIdx) continue;
      stopNodes.add(r.nodeId);
    }

    // T_c = base + Σδ（ソルバの (13) と同じ加法近似）。
    let drive = base;
    for (const p of stopNodes) {
      const d = model.delta(c, p, k);
      if (d === undefined) {
        incomplete = true;
        continue; // 欠損は 0 扱い（概算フラグで明示）
      }
      drive += d;
    }

    return { ...car, driveMin: Math.round(drive), spreadMin };
  });

  return { cars: rebuilt, kpi: computeKpi(model, rebuilt), incomplete };
}
