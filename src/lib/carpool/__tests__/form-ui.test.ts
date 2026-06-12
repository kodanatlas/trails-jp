import { describe, it, expect } from "vitest";
import {
  toApiRole,
  participationToFormRole,
  quarterHourStep,
  summarizeForPlan,
} from "../form-ui";

describe("toApiRole (R4: UI ロール → API ロール)", () => {
  it("folds passenger into rider (DB 変更なし)", () => {
    expect(toApiRole("passenger")).toBe("rider");
  });

  it("passes other roles through", () => {
    expect(toApiRole("driver")).toBe("driver");
    expect(toApiRole("rider")).toBe("rider");
    expect(toApiRole("self")).toBe("self");
    expect(toApiRole("absent")).toBe("absent");
  });
});

describe("participationToFormRole (R4/R5: 既存参加 → UI ロール)", () => {
  it("maps rider + fixedDriver to passenger (同乗者)", () => {
    expect(participationToFormRole("rider", "drv-1", false)).toBe("passenger");
  });

  it("maps rider without fixedDriver to rider (同乗希望)", () => {
    expect(participationToFormRole("rider", null, false)).toBe("rider");
  });

  it("respects driver role as-is (R5: 検出からの運転手登録)", () => {
    expect(participationToFormRole("driver", null, false)).toBe("driver");
    expect(participationToFormRole("driver", null, true)).toBe("driver");
  });

  it("maps undecided by member hasCar", () => {
    expect(participationToFormRole("undecided", null, true)).toBe("driver");
    expect(participationToFormRole("undecided", null, false)).toBe("rider");
  });

  it("passes self/absent through", () => {
    expect(participationToFormRole("self", null, false)).toBe("self");
    expect(participationToFormRole("absent", null, false)).toBe("absent");
  });
});

describe("quarterHourStep (R3: 15分刻み・既存値を壊さない)", () => {
  it("returns 900 for empty values", () => {
    expect(quarterHourStep("")).toBe(900);
  });

  it("returns 900 for quarter-aligned values", () => {
    expect(quarterHourStep("08:00")).toBe(900);
    expect(quarterHourStep("08:15")).toBe(900);
    expect(quarterHourStep("23:45")).toBe(900);
  });

  it("returns 60 for off-grid values (自動設定の分単位値を保持)", () => {
    expect(quarterHourStep("08:05")).toBe(60);
    expect(quarterHourStep("10:37")).toBe(60);
  });

  it("returns 900 for malformed values (フォーマット検証は別レイヤ)", () => {
    expect(quarterHourStep("8:05")).toBe(900);
    expect(quarterHourStep("not-a-time")).toBe(900);
  });
});

describe("summarizeForPlan (R6: 配車計画プレースホルダ)", () => {
  const p = (role: string) => ({ role });

  it("counts participants (driver+rider+self) and drivers", () => {
    const s = summarizeForPlan([
      p("driver"),
      p("driver"),
      p("rider"),
      p("self"),
      p("absent"),
      p("undecided"),
    ]);
    expect(s.participantCount).toBe(4);
    expect(s.driverCount).toBe(2);
  });

  it("is ready when 1+ driver and 1+ rider", () => {
    expect(summarizeForPlan([p("driver"), p("rider")]).ready).toBe(true);
  });

  it("is not ready without a driver or without a rider", () => {
    expect(summarizeForPlan([p("rider"), p("rider")]).ready).toBe(false);
    expect(summarizeForPlan([p("driver"), p("self")]).ready).toBe(false);
    expect(summarizeForPlan([]).ready).toBe(false);
  });
});
