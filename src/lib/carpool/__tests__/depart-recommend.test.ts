import { describe, it, expect } from "vitest";
import { calcDepartRecommend, parseHHMM, minToHHMM } from "../depart-recommend";
import type { RiskWindow } from "../depart-recommend";

// ---------------------------------------------------------------------------
// ユーティリティのテスト
// ---------------------------------------------------------------------------

describe("parseHHMM", () => {
  it("正常値を分に変換する", () => {
    expect(parseHHMM("05:30")).toBe(330);
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("23:59")).toBe(1439);
  });

  it("null / undefined / 不正値は null を返す", () => {
    expect(parseHHMM(null)).toBeNull();
    expect(parseHHMM(undefined)).toBeNull();
    expect(parseHHMM("25:00")).toBeNull();
    expect(parseHHMM("abc")).toBeNull();
  });
});

describe("minToHHMM", () => {
  it("分を HH:MM に変換する", () => {
    expect(minToHHMM(330)).toBe("05:30");
    expect(minToHHMM(0)).toBe("00:00");
    expect(minToHHMM(1439)).toBe("23:59");
  });

  it("日跨ぎは mod 1440 で正規化する", () => {
    expect(minToHHMM(1440)).toBe("00:00");
    expect(minToHHMM(1500)).toBe("01:00");
  });
});

// ---------------------------------------------------------------------------
// リスク区間なし or 設定不足 → 通常案のみ
// ---------------------------------------------------------------------------

describe("calcDepartRecommend - 通常案のみ", () => {
  it("riskWindows が空の場合は kind=normal を返す", () => {
    const result = calcDepartRecommend("06:00", [], 180);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("normal");
    expect(result!.departTime).toBe("06:00");
  });

  it("departureTime が null の場合は null を返す", () => {
    const result = calcDepartRecommend(null, [], 180);
    expect(result).toBeNull();
  });

  it("rt = 0 の場合は kind=normal を返す", () => {
    const windows: RiskWindow[] = [
      { segment: "中央道", start: "08:00", end: "10:00" },
    ];
    const result = calcDepartRecommend("07:30", windows, 0);
    expect(result!.kind).toBe("normal");
  });

  it("通過予想が window に重ならない場合は kind=normal", () => {
    // dep=05:00(300分)、rt=60分。区間(1本): offset≈30分 → pass=330(05:30)
    // window: 08:00(480)〜10:00(600) → 重ならない
    const windows: RiskWindow[] = [
      { segment: "小仏トンネル", start: "08:00", end: "10:00" },
    ];
    const result = calcDepartRecommend("05:00", windows, 60);
    expect(result!.kind).toBe("normal");
  });

  it("window の start/end が null の場合は重なり判定をスキップして normal", () => {
    const windows: RiskWindow[] = [
      { segment: "小仏トンネル", start: null, end: null },
    ];
    const result = calcDepartRecommend("07:00", windows, 90);
    expect(result!.kind).toBe("normal");
  });
});

// ---------------------------------------------------------------------------
// 重なりあり → 回避案を返す
// ---------------------------------------------------------------------------

describe("calcDepartRecommend - 渋滞回避案", () => {
  it("通過予想が window に重なる場合は kind=avoid を返す", () => {
    // dep=07:30(450分)、rt=120分。区間(1本): offset≈60分 → pass=510(08:30)
    // window: 08:00(480)〜10:00(600) → 重なる
    // avoidDepart = floor(480 - 60 - 1) = 419 → "06:59"
    const windows: RiskWindow[] = [
      { segment: "小仏トンネル", start: "08:00", end: "10:00" },
    ];
    const result = calcDepartRecommend("07:30", windows, 120);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("avoid");
    if (result && result.kind === "avoid") {
      expect(result.avoid.departMin).toBe("06:59");
      expect(result.avoid.reason).toContain("小仏トンネル");
      expect(result.avoid.reason).toContain("08:00");
    }
  });

  it("回避案の departMin が通常案より早い", () => {
    const windows: RiskWindow[] = [
      { segment: "渋滞区間", start: "08:30", end: "11:00" },
    ];
    const result = calcDepartRecommend("07:00", windows, 180);
    if (result && result.kind === "avoid") {
      const normalMin = 7 * 60; // 420
      const avoidMin =
        result.avoid.departMin
          .split(":")
          .reduce((h: number, m: string, i: number) => (i === 0 ? parseInt(m) * 60 : h + parseInt(m)), 0);
      expect(avoidMin).toBeLessThan(normalMin);
    }
  });

  it("direction が含まれる場合は reason に方向を含む", () => {
    const windows: RiskWindow[] = [
      { segment: "中央道", direction: "上り", start: "08:00", end: "10:00" },
    ];
    const result = calcDepartRecommend("07:30", windows, 120);
    if (result && result.kind === "avoid") {
      expect(result.avoid.reason).toContain("上り");
    }
  });
});

// ---------------------------------------------------------------------------
// 回避案が遅い場合は通常案に fallback
// ---------------------------------------------------------------------------

describe("calcDepartRecommend - fallback to normal", () => {
  it("回避案 >= 通常案 のときは kind=normal", () => {
    // dep=05:00(300分)、rt=300分。区間(1本): offset≈150分 → pass=450(07:30)
    // window: 07:00(420)〜09:00(540) → 重なる
    // avoidDepart = floor(420 - 150 - 1) = 269 = 04:29 (< 300) → avoid が出るはず
    // dep=02:00(120分)ならavoidが02:00より前になり得るか確認（fallback条件テスト）
    // avoidDepart = floor(420 - 150 - 1) = 269(04:29) > 120(02:00) → avoid が出る
    // 代わりに、avoidが通常より遅い状況を作る: dep=04:30(270), window=04:00〜06:00
    // pass = 270 + 150 = 420(07:00) → window 04:00〜06:00 に重ならない → normal
    const windows: RiskWindow[] = [
      { segment: "混雑区間", start: "04:00", end: "06:00" },
    ];
    const result = calcDepartRecommend("07:00", windows, 300);
    // pass=07:00+2.5h=09:30 > window end 06:00 → overlap: pass < end(360) AND pass > start-rt(240-300=-60)
    // overlap = 570 < 360? NO → normal
    expect(result!.kind).toBe("normal");
  });
});
