import { describe, it, expect } from "vitest";
import type { DisciplineDetail } from "../leg-fingerprint-details";
import {
  buildDrilldown,
  sortDrilldownRows,
  formatDelta,
  formatLap,
  excludedSummary,
  fieldSummary,
  drilldownHref,
  encodeFpParam,
  parseFpParam,
} from "../leg-fingerprint-drilldown";

// ミスの傾向ドリルダウン（docs/plans/2026-09-30_miss-trend-drilldown.md §4.2）の表示用純関数

const detail: DisciplineDetail = {
  races: [
    { d: "2026-02-22", e: "京葉OLクラブ大会", c: "M21A2", ev: 9601, cl: 1, ri: 65, L: 20 },
    { d: "2025-12-21", e: "大阪OLC50周年記念大会", c: "M21A", ev: 9511, cl: 0, ri: 70, L: 16 },
    { d: "2025-11-01", e: "集団走の大会", c: "ME", ev: 9400, cl: 0, ri: 3, L: 12, x: "pack" },
    { d: "2025-10-01", e: "クリーン不足の大会", c: "ME", ev: 9300, cl: 2, ri: 4, L: 10, x: "clean", pu: 1 },
  ],
  legs: {
    // r=レース, l=レッグ番号(0始まり), c=セル, lap/loss 秒, m=ミス判定
    r: [0, 0, 0, 1, 1],
    l: [8, 11, 0, 7, 9],
    c: [3, 3, 0, 3, 4],
    lap: [164, 66, 100, 88, 200],
    loss: [75, 38, 2, -6, 100],
    m: [1, 1, 0, 0, 1],
    fm: [60, 5, 1, null, 20],
    fn: [9, 9, 9, 0, 6],
  },
  pack: { r: [2, 2, 2, 0], l: [3, 4, 5, 15] },
};
const SEV_BINS: [number, number] = [30, 90];

describe("buildDrilldown: 選んだセル・規模の行を集める", () => {
  it("セル: そのセルのレッグをミス判定あり/なしに分け、件数 n・m を返す", () => {
    const dd = buildDrilldown(detail, { kind: "cell", cell: 3 }, SEV_BINS, "forest");
    expect(dd.n).toBe(3);
    expect(dd.m).toBe(2);
    expect(dd.miss.map((r) => [r.raceIdx, r.legIdx])).toEqual([[0, 8], [0, 11]]);
    expect(dd.clean.map((r) => [r.raceIdx, r.legIdx])).toEqual([[1, 7]]);
  });
  it("規模: そのビンのミス判定レッグだけ（ミス判定なしは出さない）", () => {
    const mid = buildDrilldown(detail, { kind: "sev", bin: 1 }, SEV_BINS, "forest"); // 30〜90 秒
    expect(mid.miss.map((r) => r.deltaSec)).toEqual([75, 38]);
    expect(mid.clean).toEqual([]);
    const big = buildDrilldown(detail, { kind: "sev", bin: 2 }, SEV_BINS, "forest"); // 90 秒以上
    expect(big.miss.map((r) => r.deltaSec)).toEqual([100]);
  });
  it("行にはレース情報・レッグ表記・想定比・規模が載る", () => {
    const [row] = buildDrilldown(detail, { kind: "cell", cell: 3 }, SEV_BINS, "forest").miss;
    expect(row).toMatchObject({
      date: "2026-02-22",
      event: "京葉OLクラブ大会",
      className: "M21A2",
      ev: 9601,
      cl: 1,
      ri: 65,
      legLabel: "8→9",
      lapSec: 164,
      deltaSec: 75,
      deltaPct: 84, // 75 / (164 − 75)
      sevBin: 1,
    });
  });
  it("レッグ表記は結果分析ページと同じ（S→1・最終は →F）", () => {
    const rows = buildDrilldown(detail, { kind: "cell", cell: 0 }, SEV_BINS, "forest").clean;
    expect(rows[0].legLabel).toBe("S→1");
    const last = buildDrilldown(
      { ...detail, legs: { r: [0], l: [19], c: [8], lap: [100], loss: [50], m: [1], fm: [10], fn: [9] } },
      { kind: "cell", cell: 8 },
      SEV_BINS,
      "forest"
    ).miss[0];
    expect(last.legLabel).toBe("19→F");
  });
});

describe("sortDrilldownRows", () => {
  const rows = buildDrilldown(detail, { kind: "cell", cell: 3 }, SEV_BINS, "forest");
  const all = [...rows.miss, ...rows.clean];
  it("日付の新しい順・同じレースはレッグ順", () => {
    expect(sortDrilldownRows(all, "date").map((r) => [r.date, r.legIdx])).toEqual([
      ["2026-02-22", 8],
      ["2026-02-22", 11],
      ["2025-12-21", 7],
    ]);
  });
  it("想定との差が大きい順", () => {
    expect(sortDrilldownRows(all, "delta").map((r) => r.deltaSec)).toEqual([75, 38, -6]);
  });
  it("元の配列を書き換えない", () => {
    const before = all.map((r) => r.legIdx);
    sortDrilldownRows(all, "delta");
    expect(all.map((r) => r.legIdx)).toEqual(before);
  });
});

describe("formatDelta / formatLap", () => {
  // 一覧の行はスマホで数字が切れないよう、結果分析ページと同じ m:ss 表記（fmtSignedSeconds）にする。
  // 「想定より」はパネル上部に「想定タイムとの差」と明記して省く
  it("遅れは「+0:45 (+38%)」「+1:15 (+84%)」（半角括弧＝3 桁の % でも iPhone 幅に収まる）", () => {
    expect(formatDelta(45, 38)).toBe("+0:45 (+38%)");
    expect(formatDelta(75, 84)).toBe("+1:15 (+84%)");
  });
  it("速いときは「-0:06」（+-6 と書かない）・0 は 0:00", () => {
    expect(formatDelta(-6, -6)).toBe("-0:06");
    expect(formatDelta(0, 0)).toBe("0:00");
  });
  it("ラップは m:ss", () => {
    expect(formatLap(164)).toBe("2:44");
    expect(formatLap(66)).toBe("1:06");
    expect(formatLap(3725)).toBe("62:05");
  });
});

describe("excludedSummary: 集計対象外の内訳", () => {
  it("不採用レースを理由付きで返し、集団走で除いたレッグ数を数える", () => {
    const s = excludedSummary(detail);
    expect(s.races.map((r) => [r.event, r.reason])).toEqual([
      ["集団走の大会", "pack"],
      ["クリーン不足の大会", "clean"],
    ]);
    expect(s.packLegs).toBe(4);
    expect(s.packUnchecked).toBe(1);
  });
});

describe("encodeFpParam / parseFpParam（開いている一覧を URL の ?fp= に残す）", () => {
  it("種目＋セル／規模を短い文字列にし、読み戻せる", () => {
    expect(encodeFpParam({ disc: "f", sel: { kind: "cell", cell: 3 } })).toBe("f-c3");
    expect(encodeFpParam({ disc: "s", sel: { kind: "sev", bin: 2 } })).toBe("s-s2");
    expect(parseFpParam("f-c3")).toEqual({ disc: "f", sel: { kind: "cell", cell: 3 } });
    expect(parseFpParam("s-s2")).toEqual({ disc: "s", sel: { kind: "sev", bin: 2 } });
  });
  it("範囲外・不正な値は null（手で書き換えられた URL でも落ちない）", () => {
    for (const bad of [null, "", "f-c9", "f-s3", "x-c1", "f-c", "f-c-1", "f-c1x", "fc3"]) {
      expect(parseFpParam(bad)).toBeNull();
    }
  });
});

describe("drilldownHref: 結果分析ページへのリンク", () => {
  it("大会ID/クラスIDと、選手・走者番号・レッグ番号・種目・日付・クラスを渡す", () => {
    const [row] = buildDrilldown(detail, { kind: "cell", cell: 3 }, SEV_BINS, "forest").miss;
    const href = drilldownHref(row, "児玉健", "forest");
    const url = new URL(href, "https://example.test");
    expect(url.pathname).toBe("/results/9601/1");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      athlete: "児玉健",
      ri: "65",
      leg: "8",
      disc: "forest",
      d: "2026-02-22",
      cn: "M21A2",
    });
  });
  it("走者番号が無いレースは ri を付けない", () => {
    const [row] = buildDrilldown(
      { ...detail, races: [{ ...detail.races[0], ri: null }, ...detail.races.slice(1)] },
      { kind: "cell", cell: 3 },
      SEV_BINS,
      "forest"
    ).miss;
    expect(new URL(drilldownHref(row, "児玉健", "forest"), "https://example.test").searchParams.has("ri")).toBe(false);
  });
});

describe("フィールド比較のラベル（結果分析ページと同じ共有判定）", () => {
  const all = (d: DisciplineDetail) => buildDrilldown(d, { kind: "cell", cell: 3 }, SEV_BINS, "forest");

  it("ミス判定の行だけに付く: 相手の中央値が大きい=難レッグ・小さい=自分のミス", () => {
    const dd = all(detail);
    // 第8レッグ: +75 秒・相手の中央値 60 秒（9 人）→ コース起因 0.8 → 難レッグ
    // 第11レッグ: +38 秒・相手の中央値 5 秒（9 人）→ 0.13 → 自分のミス
    expect(dd.miss.map((r) => [r.legIdx, r.field])).toEqual([[8, "trap"], [11, "own"]]);
    expect(dd.clean.map((r) => r.field)).toEqual([null]);
  });

  it("中間=半々・相手 8 人未満=few・相手の値なし=none", () => {
    const legs = { ...detail.legs, fm: [30, null, 1, null, 20], fn: [9, 0, 9, 0, 6] };
    const rows = buildDrilldown({ ...detail, legs }, { kind: "sev", bin: 1 }, SEV_BINS, "forest").miss;
    expect(rows.map((r) => r.field)).toEqual(["mixed", "none"]); // +75 に中央値 30（0.4）／+38 に相手なし
    const big = buildDrilldown({ ...detail, legs }, { kind: "sev", bin: 2 }, SEV_BINS, "forest").miss;
    expect(big.map((r) => r.field)).toEqual(["few"]); // 相手 6 人
  });

  it("要約はラベル別の件数（判定なしは理由別）", () => {
    const legs = { ...detail.legs, fm: [60, null, 1, null, 20], fn: [9, 0, 9, 0, 6] };
    const dd = buildDrilldown({ ...detail, legs }, { kind: "sev", bin: 1 }, SEV_BINS, "forest");
    expect(fieldSummary(dd.miss)).toEqual({ own: 0, mixed: 0, trap: 1, few: 0, none: 1 });
  });

  it("比較データの無い旧形式の明細ではラベルも要約も出さない", () => {
    const legs: Partial<DisciplineDetail["legs"]> = { ...detail.legs };
    delete legs.fm;
    delete legs.fn;
    const old = { ...detail, legs } as DisciplineDetail;
    const dd = all(old);
    expect(dd.miss.map((r) => r.field)).toEqual([null, null]);
    expect(fieldSummary(dd.miss)).toBeNull();
  });
});
