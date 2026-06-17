import { describe, it, expect } from "vitest";
import {
  weekdayOf,
  isWeekendOrHoliday,
  recentWeekendCandidates,
  selectLatestCluster,
  formatDateRangeJp,
  jstNowLabel,
} from "./weekend-window";

describe("weekdayOf", () => {
  it("既知日付の曜日（0=日..6=土）を返す", () => {
    expect(weekdayOf("2026-06-13")).toBe(6); // 土
    expect(weekdayOf("2026-06-14")).toBe(0); // 日
    expect(weekdayOf("2026-06-15")).toBe(1); // 月
  });
});

describe("isWeekendOrHoliday", () => {
  it("祝日は true（2026-05-06 = こどもの日の振替）", () => {
    expect(isWeekendOrHoliday("2026-05-06")).toBe(true);
  });
  it("平日は false（2026-06-15 = 月）", () => {
    expect(isWeekendOrHoliday("2026-06-15")).toBe(false);
  });
  it("土日は true", () => {
    expect(isWeekendOrHoliday("2026-06-13")).toBe(true); // 土
    expect(isWeekendOrHoliday("2026-06-14")).toBe(true); // 日
  });
});

describe("recentWeekendCandidates", () => {
  it("窓内の土日祝のみを昇順で列挙する", () => {
    // today=2026-06-15(月), 窓 7日 → 6/8..6/15 のうち土日: 6/13,6/14
    const out = recentWeekendCandidates("2026-06-15", 7);
    expect(out).toEqual(["2026-06-13", "2026-06-14"]);
  });
  it("窓内の祝日も含める", () => {
    // today=2026-05-07(木), 窓 7日 → 5/1..5/7。土日(5/2,5/3※祝,5/4祝,5/5祝)+祝(5/6)
    const out = recentWeekendCandidates("2026-05-07", 7);
    expect(out).toContain("2026-05-03");
    expect(out).toContain("2026-05-04");
    expect(out).toContain("2026-05-05");
    expect(out).toContain("2026-05-06"); // 祝日（火曜だが祝）
    // 昇順であること
    expect([...out].sort()).toEqual(out);
  });
  it("today 当日が土日祝なら含む", () => {
    const out = recentWeekendCandidates("2026-06-14", 28);
    expect(out[out.length - 1]).toBe("2026-06-14");
  });
});

describe("selectLatestCluster", () => {
  it("最新日 + 2日前までを返し、離れた日は除外する", () => {
    const out = selectLatestCluster([
      "2026-05-30",
      "2026-06-13",
      "2026-06-14",
    ]);
    expect(out).toEqual(["2026-06-13", "2026-06-14"]);
  });
  it("連休3日（dmax, -1, -2）はすべて含む", () => {
    const out = selectLatestCluster([
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
    ]);
    expect(out).toEqual(["2026-05-03", "2026-05-04", "2026-05-05"]);
  });
  it("dmax-3日以前は除外する", () => {
    const out = selectLatestCluster([
      "2026-05-02",
      "2026-05-05",
    ]);
    expect(out).toEqual(["2026-05-05"]);
  });
  it("単日なら単日を返す", () => {
    expect(selectLatestCluster(["2026-06-14"])).toEqual(["2026-06-14"]);
  });
  it("空なら []", () => {
    expect(selectLatestCluster([])).toEqual([]);
  });
});

describe("jstNowLabel", () => {
  it("'YYYY-MM-DD HH:mm' 形式（秒なし・分まで保持）を返す", () => {
    // 秒を誤って削るリグレッション防止（過去に :mm を落とすバグがあった）
    expect(jstNowLabel()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe("formatDateRangeJp", () => {
  it("単日", () => {
    expect(formatDateRangeJp(["2026-06-14"])).toBe("6/14");
  });
  it("同月連続", () => {
    expect(formatDateRangeJp(["2026-06-13", "2026-06-14"])).toBe("6/13–14");
  });
  it("跨ぎ月", () => {
    expect(formatDateRangeJp(["2026-06-30", "2026-07-01"])).toBe("6/30–7/1");
  });
  it("空文字", () => {
    expect(formatDateRangeJp([])).toBe("");
  });
  it("ソートされていない入力も整列して整形する", () => {
    expect(formatDateRangeJp(["2026-06-14", "2026-06-13"])).toBe("6/13–14");
  });
});
