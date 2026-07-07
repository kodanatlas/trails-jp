import { describe, it, expect } from "vitest";
import {
  parseStartSec,
  classifyMiss,
  detectPackLegs,
  detectHomonymKeys,
  bhFdr,
  mhLag1,
  mulberry32,
  buildLegFingerprintIndex,
  DEFAULT_PARAMS,
  type TrackedLegRow,
  type CompanionRow,
} from "../leg-fingerprint";
import { weightedMedian, theilSenTrend } from "../cross-race";

describe("parseStartSec / classifyMiss", () => {
  it("HH:MM:SS / HH:MM を秒に・不正は null", () => {
    expect(parseStartSec("10:35:00")).toBe(38100);
    expect(parseStartSec("9:05")).toBe(32700);
    expect(parseStartSec("")).toBeNull();
    expect(parseStartSec("abc")).toBeNull();
    expect(parseStartSec(null)).toBeNull();
  });
  it("ミス判定: max(floor, ratio×想定タイム) の境界", () => {
    // baseline=100 → 0.3×100=30
    expect(classifyMiss(130, 30, 10, 0.3)).toBe(true);
    expect(classifyMiss(129, 29, 10, 0.3)).toBe(false);
    // 短レッグはフロアが効く: baseline=20 → ratio 側は 6 だが floor=10
    expect(classifyMiss(29, 9, 10, 0.3)).toBe(false);
    expect(classifyMiss(30, 10, 10, 0.3)).toBe(true);
    // 負ロス=クリーン
    expect(classifyMiss(95, -5, 10, 0.3)).toBe(false);
  });
});

describe("bhFdr", () => {
  it("手計算既知集合", () => {
    // m=4, q=0.1: 閾値 0.025, 0.05, 0.075, 0.1
    const flags = bhFdr([0.01, 0.04, 0.2, 0.9], 0.1);
    expect(flags).toEqual([true, true, false, false]);
  });
  it("null は対象外", () => {
    const flags = bhFdr([null, 0.01, null], 0.1);
    expect(flags).toEqual([false, true, false]);
  });
});

describe("detectPackLegs", () => {
  const clock = (start: number, laps: number[]): number[] => {
    const out = [start];
    let acc = start;
    for (const l of laps) {
      acc += l;
      out.push(acc);
    }
    return out;
  };
  it("3レッグ連続同調（4境界）で内部レッグを検出・2レッグでは非検出", () => {
    const me = clock(0, [100, 100, 100, 100, 100]);
    const together3 = clock(5, [100, 100, 100, 500, 100]); // 境界0..3 が近接（レッグ1-3同調）→ レッグ4で離脱
    const packed = detectPackLegs(me, [together3], 15, 3);
    expect(packed).toEqual([true, true, true, false, false]);
    const together2 = clock(5, [100, 100, 500, 100, 100]); // 境界0..2 のみ近接 = 2レッグ
    expect(detectPackLegs(me, [together2], 15, 3)).toEqual([false, false, false, false, false]);
  });
  it("中間境界の離脱・null 境界で run が分断される", () => {
    const me = clock(0, [100, 100, 100, 100, 100]);
    const other = clock(5, [100, 100, 100, 100, 100]);
    other[2] = other[2] + 100; // 中間境界だけ離脱
    expect(detectPackLegs(me, [other], 15, 3)).toEqual([false, false, false, false, false]);
    const meNull: (number | null)[] = clock(0, [100, 100, 100, 100, 100]);
    meNull[3] = null;
    expect(detectPackLegs(meNull, [clock(5, [100, 100, 100, 100, 100])], 15, 3)).toEqual([
      false, false, false, false, false,
    ]);
  });
  it("全境界同調なら全レッグ検出（対称）", () => {
    const me = clock(0, [100, 100, 100, 100]);
    const other = clock(10, [100, 100, 100, 100]);
    expect(detectPackLegs(me, [other], 15, 3)).toEqual([true, true, true, true]);
    expect(detectPackLegs(other, [me], 15, 3)).toEqual([true, true, true, true]);
  });
});

describe("mhLag1", () => {
  it("1層なら素朴 2×2 と一致", () => {
    // a/n1 = 4/10, b/n0 = 3/30 → 素朴 RR = 0.4/0.1 = 4
    const rr = mhLag1([{ a: 4, n1: 10, b: 3, n0: 30 }]);
    expect(rr).toBeCloseTo(4);
  });
  it("悪いレース混入で素朴プールは過大・MH は各層 RR=1 なら 1 のまま", () => {
    // 層1: ミス率高いレース（RR=1）、層2: ミス率低いレース（RR=1）
    const strata = [
      { a: 5, n1: 10, b: 10, n0: 20 }, // P(次ミス)=0.5 どちらも
      { a: 0, n1: 2, b: 2, n0: 40 },   // P(次ミス)=0.0/0.05 …ほぼ低率
    ];
    const mh = mhLag1(strata);
    // 素朴プール: (5+0)/(12) ÷ (10+2)/(60) = 0.4167/0.2 = 2.08（見かけの連鎖）
    const naive = (5 / 12) / (12 / 60);
    expect(naive).toBeGreaterThan(2);
    expect(mh!).toBeLessThan(naive); // MH は交絡を除去して小さくなる
  });
  it("分母0は null", () => {
    expect(mhLag1([{ a: 1, n1: 2, b: 0, n0: 0 }])).toBeNull();
  });
});

describe("weightedMedian / 加重 theilSenTrend", () => {
  it("等重みは通常 median と一致（偶数個は中央平均）", () => {
    expect(weightedMedian([3, 1, 2], [1, 1, 1])).toBe(2);
    expect(weightedMedian([4, 1, 2, 3], [1, 1, 1, 1])).toBe(2.5);
  });
  it("支配的な重みが中央値を引き寄せる", () => {
    expect(weightedMedian([1, 2, 100], [1, 1, 10])).toBe(100);
  });
  it("theilSenTrend: 等重み weights は無加重版と厳密一致", () => {
    const arr = [10, 12, undefined, 14, 18, 16, 20];
    const plain = theilSenTrend(arr);
    const weighted = theilSenTrend(arr, 5, arr.map((v) => (v != null ? 1 : undefined)));
    expect(weighted).toEqual(plain);
  });
  it("theilSenTrend: 重み欠測は中央値補完・低重み点は傾きへの影響が減る", () => {
    // 直線 y=x 上の6点 + 外れ値1点（低重み）
    const arr = [0, 1, 2, 3, 4, 5, 100];
    const w = [10, 10, 10, 10, 10, 10, 0.001];
    const trend = theilSenTrend(arr, 5, w);
    // 端点 index6 のフィット値が外れ値(100)でなく直線(≈6)側に留まる
    expect(trend[6]!).toBeLessThan(20);
  });
});

// ---- 統合: buildLegFingerprintIndex ----

let eidSeq = 1;
function mkRace(
  key: string,
  date: string,
  type: "forest" | "sprint",
  legs: { lap: number; loss: number }[],
  opts: { eventName?: string; start?: string | null; speed?: number; club?: string | null } = {}
): TrackedLegRow {
  const eid = eidSeq++;
  const laps = legs.map((l) => l.lap);
  const elapsed: number[] = [];
  let acc = 0;
  for (const l of laps) {
    acc += l;
    elapsed.push(acc);
  }
  return {
    runner_key: key,
    event_date: date,
    event_name: opts.eventName ?? `大会${eid}`,
    class_name: "M21",
    race_type: type,
    club: opts.club === undefined ? "テストクラブ" : opts.club,
    rank: 3,
    speed: opts.speed ?? 100,
    start_time: opts.start === undefined ? "10:00:00" : opts.start,
    lap_sec: laps,
    leg_loss_sec: legs.map((l) => l.loss),
    leg_speed: laps.map(() => 100), // Ave3 = lap（レッグ長ターシルは lap で決まる）
    elapsed_sec: elapsed,
    lc_event_id: eid,
    lc_class_id: 0,
  };
}

/** 18レッグ: 序6中6終6・終盤6本は長レッグ(300s)・他は100s */
function legsWithMisses(missAt: number[]): { lap: number; loss: number }[] {
  return Array.from({ length: 18 }, (_, l) => {
    const base = l >= 12 ? 300 : 100 + l; // 終盤=長レッグ
    const miss = missAt.includes(l);
    const loss = miss ? Math.ceil(0.3 * base) + 20 : 2; // miss: ratio 超え / clean: floor 未満
    return { lap: base + loss, loss };
  });
}

describe("buildLegFingerprintIndex", () => {
  it("対立: 終盤×長レッグにミス集中 → 当該セルのみフラグ・帰無一様 → フラグなし", () => {
    const tracked: TrackedLegRow[] = [];
    // 対立選手: 8レース・毎回 終盤の長レッグ(12,14,16)+序盤1本(2) にミス
    for (let r = 0; r < 8; r++) {
      tracked.push(mkRace("偏り選手", `2026-0${(r % 8) + 1}-01`, "forest", legsWithMisses([2, 12, 14, 16])));
    }
    // 帰無選手: 9レース×2ミスで全18ポジションを正確に1回ずつカバー（セル一様）
    for (let r = 0; r < 9; r++) {
      const rot = [2 * r, 2 * r + 9].map((p) => p % 18);
      tracked.push(mkRace("一様選手", `2026-0${(r % 9) + 1}-02`, "forest", legsWithMisses(rot)));
    }
    const idx = buildLegFingerprintIndex(tracked, []);
    const biased = idx.athletes["偏り選手"]?.f;
    expect(biased).toBeDefined();
    // セル8 = 終盤(2)*3 + 長(2)
    expect(biased!.cells[8].flag).toBe(1);
    const flaggedCount = biased!.cells.filter((c) => c.flag === 1).length;
    expect(flaggedCount).toBeLessThanOrEqual(2); // 集中セル以外が大量フラグされない
    const uniform = idx.athletes["一様選手"]?.f;
    expect(uniform).toBeDefined();
    expect(uniform!.cells.every((c) => c.flag === 0)).toBe(true);
  });

  it("ゲート: 4レースは非掲載・重みリストは独立に出る", () => {
    const tracked = Array.from({ length: 4 }, (_, r) =>
      mkRace("少数選手", `2026-01-0${r + 1}`, "forest", legsWithMisses([3]))
    );
    const idx = buildLegFingerprintIndex(tracked, []);
    expect(idx.athletes["少数選手"]?.f).toBeUndefined();
    expect(idx.athletes["少数選手"]?.fr?.length).toBe(4);
  });

  it("リレー系イベントは対象外", () => {
    const tracked = Array.from({ length: 6 }, (_, r) =>
      mkRace("リレー選手", `2026-01-0${r + 1}`, "forest", legsWithMisses([3]), {
        eventName: "クラブ対抗リレー",
      })
    );
    const idx = buildLegFingerprintIndex(tracked, []);
    expect(idx.athletes["リレー選手"]).toBeUndefined();
  });

  it("パック除染: 全行程同調の companion がいるとレースが除外され legsPack が計上される", () => {
    const race = mkRace("パック選手", "2026-01-01", "forest", legsWithMisses([3]));
    const companion: CompanionRow = {
      lc_event_id: race.lc_event_id,
      lc_class_id: 0,
      runner_index: 99,
      start_time: "10:00:05",
      elapsed_sec: race.elapsed_sec, // ほぼ同時刻で全行程随伴
    };
    const clean = Array.from({ length: 5 }, (_, r) =>
      mkRace("パック選手", `2026-02-0${r + 1}`, "forest", legsWithMisses([3, 13]))
    );
    const idx = buildLegFingerprintIndex([race, ...clean], [companion]);
    const fp = idx.athletes["パック選手"]?.f;
    expect(fp).toBeDefined();
    expect(fp!.racesUsed).toBe(5); // パックレースはプール不採用
    expect(fp!.legsPack).toBeGreaterThan(0);
  });

  it("start 不明レースは packUnchecked に計上されつつ採用される", () => {
    const tracked = Array.from({ length: 5 }, (_, r) =>
      mkRace("開始不明", `2026-03-0${r + 1}`, "forest", legsWithMisses([4, 13]), { start: null })
    );
    const idx = buildLegFingerprintIndex(tracked, []);
    const fp = idx.athletes["開始不明"]?.f;
    expect(fp).toBeDefined();
    expect(fp!.packUnchecked).toBe(5);
    expect(fp!.racesUsed).toBe(5);
  });

  it("重大度ビンとミス率・決定性（同一入力で同一出力）", () => {
    const tracked = Array.from({ length: 6 }, (_, r) =>
      mkRace("安定選手", `2026-04-0${r + 1}`, "forest", legsWithMisses([2, 12]))
    );
    const a = buildLegFingerprintIndex(tracked, []);
    const b = buildLegFingerprintIndex(tracked, []);
    expect(JSON.stringify(a.athletes)).toBe(JSON.stringify(b.athletes));
    const fp = a.athletes["安定選手"]!.f!;
    expect(fp.missRate).toBeCloseTo(2 / 18, 2);
    expect(fp.sev[0] + fp.sev[1] + fp.sev[2]).toBe(12); // 6レース×2ミス
  });

  it("mulberry32 は決定的", () => {
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });
});

// ---- Stage 2c ----

describe("detectHomonymKeys / 同姓同名除外（物理矛盾＋クラブ相違）", () => {
  it("(i) 同一クラスにクラブ相違の ranked 2行で検出・同クラブ（練習会の再走）は非検出", () => {
    const a = mkRace("重複太郎", "2026-01-01", "forest", legsWithMisses([3]), { club: "クラブA" });
    const b = mkRace("重複太郎", "2026-01-01", "forest", legsWithMisses([5]), { club: "クラブB" });
    b.lc_event_id = a.lc_event_id; // 同一大会・同一クラスに揃える
    expect(detectHomonymKeys([a, b]).has("重複太郎")).toBe(true);
    // 同クラブ（再走）・クラブ包含（松塾/松塾2回目）・クラブ欠落は非検出
    const c = mkRace("再走次郎", "2026-01-02", "forest", legsWithMisses([3]), { club: "松塾" });
    const d = mkRace("再走次郎", "2026-01-02", "forest", legsWithMisses([5]), { club: "松塾2回目" });
    d.lc_event_id = c.lc_event_id;
    expect(detectHomonymKeys([c, d]).has("再走次郎")).toBe(false);
    const e = mkRace("無所属三郎", "2026-01-03", "forest", legsWithMisses([3]), { club: null });
    const f = mkRace("無所属三郎", "2026-01-03", "forest", legsWithMisses([5]), { club: null });
    f.lc_event_id = e.lc_event_id;
    expect(detectHomonymKeys([e, f]).has("無所属三郎")).toBe(false);
  });
  it("(ii) 同日別大会の時間重複＋クラブ相違で検出・順次出走や重複掲載は非検出", () => {
    // 各レース ~18レッグ×100s+ ≈ 30分強
    const r1 = mkRace("同時二郎", "2026-02-01", "forest", legsWithMisses([3]), { start: "10:00:00", club: "クラブA" });
    const r2 = mkRace("同時二郎", "2026-02-01", "forest", legsWithMisses([4]), { start: "10:10:00", club: "クラブB" });
    expect(detectHomonymKeys([r1, r2]).has("同時二郎")).toBe(true);
    // 順次出走（重複なし）
    const s1 = mkRace("順次三郎", "2026-02-02", "forest", legsWithMisses([3]), { start: "10:00:00", club: "クラブA" });
    const s2 = mkRace("順次三郎", "2026-02-02", "forest", legsWithMisses([4]), { start: "13:00:00", club: "クラブB" });
    expect(detectHomonymKeys([s1, s2]).has("順次三郎")).toBe(false);
    // 重複掲載（開始・終了ほぼ同時刻）はクラブ相違でも非検出
    const p1 = mkRace("掲載四郎", "2026-02-03", "forest", legsWithMisses([3]), { start: "10:00:00", club: "クラブA" });
    const p2 = mkRace("掲載四郎", "2026-02-03", "forest", legsWithMisses([3]), { start: "10:00:30", club: "クラブB" });
    expect(detectHomonymKeys([p1, p2]).has("掲載四郎")).toBe(false);
  });
  it("検出された名前は index から丸ごと消え homonymExcluded に計上される", () => {
    const dup1 = mkRace("重複太郎", "2026-01-01", "forest", legsWithMisses([3]), { club: "クラブA" });
    const dup2 = mkRace("重複太郎", "2026-01-01", "forest", legsWithMisses([5]), { club: "クラブB" });
    dup2.lc_event_id = dup1.lc_event_id;
    const clean = Array.from({ length: 5 }, (_, r) =>
      mkRace("健全四郎", `2026-03-0${r + 1}`, "forest", legsWithMisses([3, 13]))
    );
    const idx = buildLegFingerprintIndex([dup1, dup2, ...clean], []);
    expect(idx.athletes["重複太郎"]).toBeUndefined();
    expect(idx.homonymExcluded).toBe(1);
    expect(idx.athletes["健全四郎"]?.fr?.length).toBe(5);
  });
});

describe("フォーク形式クラスの名前除外（構造検出は評価の上棄却）", () => {
  it("バタフライ/farsta 系イベントは対象外", () => {
    for (const name of ["バタフライ練習会", "Farsta形式スプリント"]) {
      const tracked = Array.from({ length: 6 }, (_, r) =>
        mkRace("フォーク五郎", `2026-01-0${r + 1}`, "forest", legsWithMisses([3]), { eventName: name })
      );
      expect(buildLegFingerprintIndex(tracked, []).athletes["フォーク五郎"]).toBeUndefined();
    }
  });
});

describe("コホート帯基準（記述比較）", () => {
  it("速い帯ほどミス率が低い norms が出て band が割り当たる", () => {
    const tracked: TrackedLegRow[] = [];
    // 速い10人（speed 100・1ミス/レース）と遅い10人（speed 150・5ミス/レース）× 各6レース
    for (let a = 0; a < 10; a++) {
      for (let r = 0; r < 6; r++) {
        tracked.push(
          mkRace(`速手${a}`, `2026-0${(r % 6) + 1}-10`, "forest", legsWithMisses([(a + r) % 18]), { speed: 100 })
        );
        tracked.push(
          mkRace(
            `遅手${a}`,
            `2026-0${(r % 6) + 1}-11`,
            "forest",
            legsWithMisses([0, 4, 8, 12, 16].map((p) => (p + a + r) % 18)),
            { speed: 150 }
          )
        );
      }
    }
    const idx = buildLegFingerprintIndex(tracked, [], { cohortBands: { forest: 2, sprint: 2 } });
    const norms = idx.cohorts?.f;
    expect(norms).toBeDefined();
    expect(norms!.bands.length).toBe(2);
    expect(norms!.bands[0].athletes).toBe(10);
    const rate = (b: number) => {
      const [n, m] = norms!.bands[b].cells.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1]], [0, 0]);
      return m / n;
    };
    expect(rate(0)).toBeLessThan(rate(1)); // 速い帯（band 0）の方が低ミス率
    expect(idx.athletes["速手0"]?.f?.band).toBe(0);
    expect(idx.athletes["遅手0"]?.f?.band).toBe(1);
  });
  it("掲載選手が帯あたり10人未満なら cohorts を出さない", () => {
    const tracked = Array.from({ length: 6 }, (_, r) =>
      mkRace("単独六郎", `2026-01-0${r + 1}`, "forest", legsWithMisses([3, 13]))
    );
    const idx = buildLegFingerprintIndex(tracked, []);
    expect(idx.cohorts?.f).toBeUndefined();
    expect(idx.athletes["単独六郎"]?.f?.band).toBeUndefined();
  });
});
