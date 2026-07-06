import { describe, it, expect } from "vitest";
import {
  median,
  mad,
  quantile,
  theilSen,
  theilSenTrend,
  buildCrossRaceIndex,
  type LcRaceRow,
} from "./cross-race";

/** テスト用レース行を量産するヘルパ */
function races(
  name: string,
  type: "forest" | "sprint",
  values: { speed: number; miss: number }[]
): LcRaceRow[] {
  return values.map((v, i) => ({
    name,
    date: `2026-0${(i % 9) + 1}-01`,
    event: `event-${i}`,
    speed: v.speed,
    miss: v.miss,
    type,
  }));
}

describe("median / mad / quantile", () => {
  it("median: 奇数・偶数・単一", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([7])).toBe(7);
  });

  it("mad: 既知値（定数列は 0）", () => {
    // [1,2,3,4,5] median=3, |x-3|=[2,1,0,1,2] median=1 → 1.4826
    expect(mad([1, 2, 3, 4, 5])).toBeCloseTo(1.4826, 4);
    expect(mad([5, 5, 5])).toBe(0);
  });

  it("quantile: 線形補間", () => {
    expect(quantile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25);
    expect(quantile([10], 0.75)).toBe(10);
  });
});

describe("theilSen", () => {
  it("厳密な直線 y=2x+1 を復元する", () => {
    const pts = [0, 1, 2, 3, 4].map((x) => ({ x, y: 2 * x + 1 }));
    const fit = theilSen(pts);
    expect(fit).not.toBeNull();
    expect(fit!.slope).toBeCloseTo(2);
    expect(fit!.intercept).toBeCloseTo(1);
  });

  it("単一の外れ値に頑健（最小二乗なら傾きが動く）", () => {
    const pts = [0, 1, 2, 3, 4, 5, 6].map((x) => ({ x, y: x }));
    pts[6] = { x: 6, y: 100 }; // 外れ値
    const fit = theilSen(pts);
    // pairwise slope の中央値は 1 のまま
    expect(fit!.slope).toBeCloseTo(1);
  });

  it("縮退: Δx=0 のみ → null、2点未満 → null", () => {
    expect(theilSen([{ x: 1, y: 1 }, { x: 1, y: 5 }])).toBeNull();
    expect(theilSen([{ x: 1, y: 1 }])).toBeNull();
    expect(theilSen([])).toBeNull();
  });
});

describe("theilSenTrend（チャートのトレンド線契約）", () => {
  it("5点未満は全 undefined（ゲート）", () => {
    const arr = [1, 2, 3, 4] as (number | undefined)[];
    expect(theilSenTrend(arr).every((v) => v === undefined)).toBe(true);
  });

  it("5点以上は最初と最後のデータ点のみ埋める（undefined の隙間は保持）", () => {
    const arr: (number | undefined)[] = [10, undefined, 12, 14, undefined, 16, 18];
    const out = theilSenTrend(arr);
    expect(out[0]).toBeDefined();
    expect(out[6]).toBeDefined();
    expect(out[1]).toBeUndefined();
    expect(out[2]).toBeUndefined();
    expect(out[4]).toBeUndefined();
    // 単調増加系列 → 両端は昇順
    expect(out[6]!).toBeGreaterThan(out[0]!);
  });
});

describe("buildCrossRaceIndex", () => {
  it("空入力 → 有効なスケルトン", () => {
    const idx = buildCrossRaceIndex([]);
    expect(idx.disciplines).toEqual({});
    expect(idx.athletes).toEqual({});
    expect(idx.params.minRaces).toBe(5);
  });

  it("n<5 の選手は除外・n>=5 は掲載（種目別に独立判定）", () => {
    const rows = [
      ...races("A", "forest", Array.from({ length: 5 }, () => ({ speed: 100, miss: 8 }))),
      ...races("A", "sprint", Array.from({ length: 4 }, () => ({ speed: 100, miss: 8 }))),
      ...races("B", "forest", Array.from({ length: 4 }, () => ({ speed: 100, miss: 8 }))),
    ];
    // 回帰には選手2人以上必要なので水増し
    for (let i = 0; i < 10; i++) {
      rows.push(
        ...races(`C${i}`, "forest", Array.from({ length: 5 }, () => ({ speed: 95 + i, miss: 6 + i * 0.5 })))
      );
    }
    const idx = buildCrossRaceIndex(rows);
    expect(idx.athletes["A"]?.f).toBeDefined();
    expect(idx.athletes["A"]?.s).toBeUndefined(); // sprint n=4 → 除外
    expect(idx.athletes["B"]).toBeUndefined(); // forest n=4 → 不掲載
  });

  it("残差の符号と百分位: 回帰線より下（ミス少）が z<0・pct 小", () => {
    // 20人を直線 miss = 0.5*speed - 40 の近傍（±0.3 の交互ノイズ・MAD>0 を保証）に配置し、2人だけ大きくずらす
    const rows: LcRaceRow[] = [];
    for (let i = 0; i < 20; i++) {
      const speed = 90 + i;
      const miss = 0.5 * speed - 40 + (i % 2 === 0 ? 0.3 : -0.3);
      rows.push(...races(`on${i}`, "forest", Array.from({ length: 5 }, () => ({ speed, miss }))));
    }
    rows.push(...races("good", "forest", Array.from({ length: 5 }, () => ({ speed: 100, miss: 10 - 4 })))); // 期待10 → 実績6
    rows.push(...races("bad", "forest", Array.from({ length: 5 }, () => ({ speed: 100, miss: 10 + 4 })))); // 期待10 → 実績14
    const idx = buildCrossRaceIndex(rows);
    const good = idx.athletes["good"]!.f!;
    const bad = idx.athletes["bad"]!.f!;
    expect(good.z).toBeLessThan(0);
    expect(bad.z).toBeGreaterThan(0);
    expect(good.pct).toBeLessThan(bad.pct);
    expect(good.exp).toBeCloseTo(10, 0);
  });

  it("方向ガード: 速い選手 = speed が小さい側。回帰の期待値は speed に単調", () => {
    const rows: LcRaceRow[] = [];
    for (let i = 0; i < 15; i++) {
      const speed = 90 + i * 2;
      rows.push(...races(`ath${i}`, "forest", Array.from({ length: 5 }, () => ({ speed, miss: 4 + i })))); // 遅いほどミス多
    }
    const idx = buildCrossRaceIndex(rows);
    const fast = idx.athletes["ath0"]!.f!; // speed=90 = 最速
    const slow = idx.athletes["ath14"]!.f!; // speed=118 = 最遅
    expect(fast.spd).toBeLessThan(slow.spd);
    expect(fast.exp).toBeLessThan(slow.exp); // 正の傾き → 速い側の期待ミスは低い
    expect(idx.disciplines.forest!.fit.slope).toBeGreaterThan(0);
  });

  it("高ミス率レース割合: 種目内 Q3 以上のレースを数える", () => {
    const rows: LcRaceRow[] = [];
    for (let i = 0; i < 10; i++) {
      // 各選手 miss = [2,4,6,8,20] → 全体の Q3 は高め・各選手1本は必ず超える
      rows.push(...races(`q${i}`, "forest", [2, 4, 6, 8, 20].map((m) => ({ speed: 100 + i, miss: m }))));
    }
    const idx = buildCrossRaceIndex(rows);
    const a = idx.athletes["q0"]!.f!;
    expect(a.blow).toBeGreaterThanOrEqual(1);
    expect(a.blow).toBeLessThanOrEqual(2);
    expect(idx.disciplines.forest!.q3Miss).toBeGreaterThan(6);
  });

  it("完全同値の重複行のみ除去（別クラス出走＝別レースはそのまま数える）", () => {
    const dup: LcRaceRow = { name: "D", date: "2026-05-01", event: "ev", speed: 100, miss: 8, type: "forest" };
    const rows: LcRaceRow[] = [
      dup,
      { ...dup }, // 完全同値 → 1本に
      { ...dup, speed: 104, miss: 12 }, // 同日同大会でも値が違う＝別クラスの実走 → 数える
      ...races("D", "forest", Array.from({ length: 3 }, () => ({ speed: 102, miss: 9 }))),
    ];
    for (let i = 0; i < 5; i++) {
      rows.push(...races(`E${i}`, "forest", Array.from({ length: 5 }, () => ({ speed: 96 + i, miss: 7 }))));
    }
    const idx = buildCrossRaceIndex(rows);
    expect(idx.athletes["D"]!.f!.n).toBe(5); // 1(dedup) + 1 + 3
  });

  it("MAD=0 の縮退で z が発散しない", () => {
    const rows: LcRaceRow[] = [];
    for (let i = 0; i < 8; i++) {
      const speed = 90 + i;
      rows.push(...races(`m${i}`, "forest", Array.from({ length: 5 }, () => ({ speed, miss: 0.5 * speed })))); // 全員厳密に直線上 → 残差全0 → MAD=0
    }
    const idx = buildCrossRaceIndex(rows);
    for (const key of Object.keys(idx.athletes)) {
      const e = idx.athletes[key].f!;
      expect(Number.isFinite(e.z)).toBe(true);
      expect(e.z).toBe(0);
    }
  });
});
