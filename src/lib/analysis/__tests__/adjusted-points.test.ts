import { describe, it, expect } from "vitest";
import {
  oneYearBefore,
  poolEvents,
  top3Average,
  gapAt,
  levelPercentile,
  estimateSprintGapModel,
  sprintGapFor,
  computeAdjustedTop3,
  fillPoint,
  inferWindowStart,
  type ScoreEvent,
  type PairedAthleteInput,
} from "../adjusted-points";

const ev = (date: string, points: number, eventName = `大会${date}`): ScoreEvent => ({ date, eventName, points });

describe("oneYearBefore", () => {
  it("1年前の同日を返す", () => {
    expect(oneYearBefore("2026-11-04")).toBe("2025-11-04");
  });
  it("うるう日は前年の2/28にする", () => {
    expect(oneYearBefore("2028-02-29")).toBe("2027-02-28");
  });
});

describe("poolEvents", () => {
  it("日付なし（補完）・窓外・0点以下を除く", () => {
    const out = poolEvents(
      [ev("2026-01-01", 3000), ev("", 2900, "補完1"), ev("2025-10-01", 3100), ev("2026-02-01", 0)],
      "2025-11-04",
    );
    expect(out.map((e) => e.points)).toEqual([3000]);
  });
  it("窓の開始日ちょうどは含める", () => {
    expect(poolEvents([ev("2025-11-04", 1000)], "2025-11-04")).toHaveLength(1);
  });
  it("同じ大会（日付＋大会名）が重複したら1件にまとめ、高い方を残す", () => {
    const out = poolEvents([ev("2026-01-01", 1000, "A"), ev("2026-01-01", 1200, "A"), ev("2026-01-01", 900, "B")], "2025-01-01");
    expect(out.map((e) => e.points).sort()).toEqual([1200, 900].sort());
  });
});

describe("top3Average", () => {
  it("上位3の平均", () => {
    expect(top3Average([1, 5, 3, 4])).toBe(4);
  });
  it("3未満はある分の平均・空は null", () => {
    expect(top3Average([10, 20])).toBe(15);
    expect(top3Average([])).toBeNull();
  });
});

describe("gapAt", () => {
  const nodes = [
    { pct: 0.1, gap: 200 },
    { pct: 0.5, gap: 300 },
  ];
  it("節点の間は線形補間", () => {
    expect(gapAt(0.3, nodes)).toBeCloseTo(250);
  });
  it("範囲外は端の値で頭打ち", () => {
    expect(gapAt(0, nodes)).toBe(200);
    expect(gapAt(1, nodes)).toBe(300);
  });
});

describe("levelPercentile", () => {
  const ref = [400, 300, 200, 100]; // 降順
  it("上位ほど小さい（0=トップ）", () => {
    expect(levelPercentile(500, ref)).toBe(0);
    expect(levelPercentile(50, ref)).toBe(1);
    expect(levelPercentile(300, ref)).toBeCloseTo(0.375); // 上に1人＋同値0.5人 / 4
  });
});

describe("estimateSprintGapModel", () => {
  // 水準が高いほど差が小さい合成データ（男女とも）
  const make = (female: boolean, n: number): PairedAthleteInput[] =>
    Array.from({ length: n }, (_, i) => {
      const f = 3000 - i * 10; // i=0 がトップ
      const d = 150 + i * 2; // 下位ほど差が大きい
      return { female, forest: [f, f - 5, f - 10], sprint: [f + d, f + d - 5, f + d - 10] };
    });
  const model = estimateSprintGapModel([...make(false, 200), ...make(true, 100)]);

  it("ペア選手から4層の節点を作り、水準が下がるほど gap が大きい", () => {
    expect(model).not.toBeNull();
    expect(model!.nodes).toHaveLength(4);
    const gaps = model!.nodes.map((n) => n.gap);
    expect([...gaps].sort((a, b) => a - b)).toEqual(gaps);
    expect(model!.pairedCount).toBe(300);
  });

  it("節点は男女共通（各層に入る男女全員の差の中央値）", () => {
    const shifted = (n: number) => make(true, n).map((a) => ({ ...a, sprint: a.sprint.map((v) => v + 100) }));
    const m = estimateSprintGapModel([...make(false, 400), ...shifted(40)])!;
    const tiers = [[0, 0.1], [0.1, 0.25], [0.25, 0.5], [0.5, 1.0001]];
    const ds = (n: number, shift: number, lo: number, hi: number) =>
      Array.from({ length: n }, (_, i) => i)
        .filter((i) => i / (n - 1) >= lo && i / (n - 1) < hi)
        .map((i) => 150 + 2 * i + shift);
    const med = (v: number[]) => {
      const t = [...v].sort((x, y) => x - y);
      const k = t.length >> 1;
      return t.length % 2 ? t[k] : (t[k - 1] + t[k]) / 2;
    };
    m.nodes.forEach((n, i) => {
      const [lo, hi] = tiers[i];
      expect(n.gap).toBeCloseTo(med([...ds(400, 0, lo, hi), ...ds(40, 100, lo, hi)]), 0);
    });
  });

  it("3大会未満の選手は推定に使わない", () => {
    const m = estimateSprintGapModel([
      ...make(false, 200),
      { female: false, forest: [1], sprint: [99999, 99999, 99999] },
    ]);
    expect(m!.pairedCount).toBe(200);
  });

  it("どこかの層が人数不足なら null（補正の形を黙って変えない）", () => {
    // 男子30人だけ → 上位10%層は3人で MIN_TIER_COUNT 未満
    expect(estimateSprintGapModel(make(false, 30))).toBeNull();
  });

  it("ペアが少なすぎると null", () => {
    expect(estimateSprintGapModel(make(false, 10))).toBeNull();
  });

  it("sprintGapFor: 水準が高いほど小さい gap（S のみの選手）", () => {
    const top = sprintGapFor(false, [], [3200, 3200, 3200], model!)!;
    const low = sprintGapFor(false, [], [1500, 1500, 1500], model!)!;
    expect(top).toBeLessThan(low);
  });

  it("sprintGapFor: 両種目3大会以上なら両種目平均の水準を使う", () => {
    // S は低いが F が高い選手 → 両種目平均で見るとトップ寄り → S のみで見るより gap が小さい
    const both = sprintGapFor(false, [3000, 3000, 3000], [2000, 2000, 2000], model!)!;
    const sOnly = sprintGapFor(false, [], [2000, 2000, 2000], model!)!;
    expect(both).toBeLessThan(sOnly);
  });

  it("sprintGapFor: スプリントの大会が無ければ null", () => {
    expect(sprintGapFor(false, [3000], [], model!)).toBeNull();
  });
});

describe("computeAdjustedTop3", () => {
  it("スプリントは gap を引いてから混在で上位3を合計", () => {
    const r = computeAdjustedTop3([ev("2026-01-01", 1000), ev("2026-01-02", 900)], [ev("2026-01-03", 1200), ev("2026-01-04", 950)], 250);
    // 補正後: F1000, F900, S950, S700 → 上位3 = 1000+950+900
    expect(r.total).toBe(2850);
    expect(r.top3.map((e) => e.discipline)).toEqual(["forest", "sprint", "forest"]);
    expect(r.top3[1].corrected).toBe(950);
  });
  it("大会が無ければ null", () => {
    expect(computeAdjustedTop3([], [], 100).total).toBeNull();
  });
});

describe("補完（JOY の不足枠埋め）", () => {
  it("fillPoint は日付なしの補完行だけを拾う", () => {
    expect(fillPoint([ev("", 2800, "補完1"), ev("2026-01-01", 3000)])).toBe(2800);
    expect(fillPoint([ev("2026-01-01", 3000)])).toBeNull();
  });
  it("実大会が3未満なら補完を1枠だけ足す（スプリントは差引後）", () => {
    const r = computeAdjustedTop3([], [ev("2026-01-01", 3000)], 300, { forest: null, sprint: 2800 });
    expect(r.top3).toHaveLength(2);
    expect(r.total).toBe(2700 + 2500);
  });
  it("両種目の補完があれば補正後の高い方を使う", () => {
    const r = computeAdjustedTop3([ev("2026-01-01", 2000)], [ev("2026-01-02", 3000)], 300, { forest: 1900, sprint: 2800 });
    expect(r.top3.map((e) => e.corrected)).toEqual([2700, 2500, 2000]);
  });
  it("実大会が3以上なら補完は使わない", () => {
    const r = computeAdjustedTop3([ev("2026-01-01", 1000), ev("2026-01-02", 1000), ev("2026-01-03", 1000)], [], 0, { forest: 5000, sprint: null });
    expect(r.total).toBe(3000);
  });
});

describe("inferWindowStart", () => {
  it("JOY の合計点を再現する窓の開始日を返す", () => {
    const entries = [
      // 2025-10-01 は窓外（合計に入っていない）
      { total: 3000 + 2900 + 2800, events: [ev("2026-01-01", 3000), ev("2026-02-01", 2900), ev("2026-03-01", 2800), ev("2025-10-01", 3500)] },
      // 実大会1つ＋補完
      { total: 2000 + 1800, events: [ev("2026-01-01", 2000), ev("", 1800, "補完1"), ev("2025-10-15", 2500)] },
    ];
    const r = inferWindowStart(entries)!;
    expect(r.windowStart).toBe("2026-01-01");
    expect(r.matchRate).toBe(1);
  });
});
