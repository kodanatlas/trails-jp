/**
 * depart-recommend.ts - 出発時刻リコメンド（純粋関数）
 *
 * 仕様: 03_最適化モデル.md S7-2
 * route.riskWindows に対し、出発時刻からのリスク区間通過予想が時間帯と重なる場合、
 * 「区間を window.start 前に通過する出発案」を通常案と並べて返す。
 */

export interface RiskWindow {
  segment: string;
  direction?: string | null;
  start?: string | null;
  end?: string | null;
  typical_delay_min?: number | null;
}

export interface DepartNormal {
  kind: "normal";
  departTime: string;
}

export interface DepartWithAvoid {
  kind: "avoid";
  departTime: string;
  avoid: {
    departMin: string;
    reason: string;
  };
}

export type DepartRecommend = DepartNormal | DepartWithAvoid;

// ---------------------------------------------------------------------------
// 内部ユーティリティ
// ---------------------------------------------------------------------------

/** "HH:MM" -> 0時からの分。不正値は null。 */
export function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** 分 -> "HH:MM"。日跨ぎは mod 1440 で正規化。 */
export function minToHHMM(totalMin: number): string {
  const normalized = ((totalMin % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const mm = normalized % 60;
  const hh = String(h).padStart(2, "0");
  const mmStr = String(mm).padStart(2, "0");
  return hh + ":" + mmStr;
}

/**
 * 出発時刻から各リスク区間への通過予想時刻を近似で求め、
 * 最初に重なった window を返す。
 *
 * 近似: 区間オフセット = rt * (i + 0.5) / windows.length
 */
function findFirstConflict(
  departMin: number,
  rt: number,
  windows: RiskWindow[],
): { window: RiskWindow; avoidDepartMin: number } | null {
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const windowStart = parseHHMM(w.start);
    const windowEnd = parseHHMM(w.end);
    if (windowStart === null || windowEnd === null) continue;

    // 深夜跨ぎの window は対象外（仕様で明示）。
    if (windowEnd <= windowStart) continue;

    const segOffset = rt > 0 ? rt * ((i + 0.5) / windows.length) : 0;
    const passMin = departMin + segOffset;

    if (passMin < windowEnd && passMin > windowStart - rt) {
      // 区間を windowStart-1 分前に通過するために必要な出発時刻。
      const avoidDepartMin = Math.floor(windowStart - segOffset - 1);
      return { window: w, avoidDepartMin };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 公開関数
// ---------------------------------------------------------------------------

/**
 * 出発時刻リコメンドを計算する。
 *
 * @param departureTime  通常出発時刻 "HH:MM"
 * @param riskWindows    route.riskWindows（unknown[] としてキャスト）
 * @param rt             ルート所要時間（分）
 * @returns DepartRecommend、または departureTime が null/不正なら null
 */
export function calcDepartRecommend(
  departureTime: string | null | undefined,
  riskWindows: unknown[],
  rt: number,
): DepartRecommend | null {
  if (!departureTime) return null;

  const departMin = parseHHMM(departureTime);
  if (departMin === null) return null;

  const normal: DepartNormal = { kind: "normal", departTime: departureTime };

  if (!riskWindows || riskWindows.length === 0 || rt <= 0) return normal;

  const windows: RiskWindow[] = (riskWindows as RiskWindow[]).filter(
    (w) => w && typeof w === "object" && typeof w.segment === "string",
  );

  if (windows.length === 0) return normal;

  const conflict = findFirstConflict(departMin, rt, windows);
  if (!conflict) return normal;

  const { window: w, avoidDepartMin } = conflict;

  // 回避案が通常案と同じかそれより遅い場合は通常案のみ返す。
  if (avoidDepartMin >= departMin) return normal;

  const dirLabel = w.direction ? (" " + w.direction) : "";
  const startLabel = w.start ?? "";
  const endLabel = w.end ?? "";
  const windowLabel = (startLabel && endLabel) ? (" " + startLabel + "~" + endLabel) : "";
  const reason = w.segment + dirLabel + " 混雑帯" + windowLabel + " 前に通過";

  return {
    kind: "avoid",
    departTime: departureTime,
    avoid: {
      departMin: minToHHMM(avoidDepartMin),
      reason,
    },
  };
}
