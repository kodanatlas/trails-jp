/**
 * レッグ単位の Head-to-Head（同一コース＝同一クラスを走った2選手の区間タイム比較）。
 * 純ロジックのみ（I/O なし）。API が lc_leg_splits の2走者行を渡して呼ぶ。
 *
 * 「勝ったレッグ」＝そのレッグの区間タイム（lap_sec）が相手より速いレッグ。
 * 同じ大会でも別クラス（別コース）なら比較不能なので、同一 (lc_event_id, lc_class_id) のみ対象。
 */

export interface LegH2HRow {
  lc_event_id: number;
  lc_class_id: number;
  event_date: string;
  event_name: string;
  class_name: string;
  race_type: "forest" | "sprint";
  runner_key: string;
  lap_sec: (number | null)[];
}

export interface LegH2HRace {
  date: string;
  eventName: string;
  className: string;
  discipline: "forest" | "sprint";
  wonA: number; // A の方が速かったレッグ数
  wonB: number;
  tied: number;
  legs: number; // 比較できたレッグ数（両者とも lap_sec あり）
}

export interface LegH2HResult {
  races: LegH2HRace[]; // 日付降順・同一クラスで対戦したレースのみ
  wonA: number;
  wonB: number;
  tied: number;
  legs: number;
}

const EMPTY: LegH2HResult = { races: [], wonA: 0, wonB: 0, tied: 0, legs: 0 };

/**
 * 2走者の lc_leg_splits 行群からレッグ勝敗を集計する。
 * keyA=自分, keyB=相手。同一 (lc_event_id, lc_class_id) に両者が居るレースのみ比較。
 */
export function buildLegH2H(rows: LegH2HRow[], keyA: string, keyB: string): LegH2HResult {
  if (keyA === keyB) return EMPTY;
  // (event,class) → { a, b }
  const byRace = new Map<string, { a?: LegH2HRow; b?: LegH2HRow }>();
  for (const r of rows) {
    if (r.runner_key !== keyA && r.runner_key !== keyB) continue;
    const k = `${r.lc_event_id}:${r.lc_class_id}`;
    const slot = byRace.get(k) ?? {};
    if (r.runner_key === keyA) slot.a = r;
    else slot.b = r;
    byRace.set(k, slot);
  }

  const races: LegH2HRace[] = [];
  let wonA = 0;
  let wonB = 0;
  let tied = 0;
  let legs = 0;
  for (const { a, b } of byRace.values()) {
    if (!a || !b) continue; // 両者が同一クラスに居るレースのみ
    const n = Math.min(a.lap_sec.length, b.lap_sec.length);
    let rWonA = 0;
    let rWonB = 0;
    let rTied = 0;
    let rLegs = 0;
    for (let l = 0; l < n; l++) {
      const la = a.lap_sec[l];
      const lb = b.lap_sec[l];
      if (la == null || lb == null || la <= 0 || lb <= 0) continue;
      rLegs++;
      if (la < lb) rWonA++;
      else if (la > lb) rWonB++;
      else rTied++;
    }
    if (rLegs === 0) continue;
    races.push({
      date: a.event_date,
      eventName: a.event_name,
      className: a.class_name,
      discipline: a.race_type,
      wonA: rWonA,
      wonB: rWonB,
      tied: rTied,
      legs: rLegs,
    });
    wonA += rWonA;
    wonB += rWonB;
    tied += rTied;
    legs += rLegs;
  }

  races.sort((x, y) => y.date.localeCompare(x.date));
  return { races, wonA, wonB, tied, legs };
}
