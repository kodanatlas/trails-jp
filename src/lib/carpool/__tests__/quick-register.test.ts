import { describe, it, expect } from "vitest";
import { planQuickRegister } from "../quick-register";

const base = {
  memberId: null as string | null,
  nameKey: "山田太郎",
  rawName: null as string | null,
  className: "M21A" as string | null,
  displayNameInput: null as string | null,
};

describe("planQuickRegister (M4: 検出行の単独クイック登録)", () => {
  it("skips member creation for an already-matched member", () => {
    const plan = planQuickRegister({ ...base, memberId: "m-1" }, "driver");
    expect(plan.memberBody).toBeNull();
    expect(plan.role).toBe("driver");
    expect(plan.className).toBe("M21A");
  });

  it("builds a member body for an unregistered entry (athleteKey = nameKey 不変)", () => {
    const plan = planQuickRegister(base, "rider");
    expect(plan.memberBody).toEqual({
      displayName: "山田太郎",
      athleteKey: "山田太郎",
      hasCar: false,
    });
  });

  it("prefers the name-confirmation input over rawName/nameKey", () => {
    const plan = planQuickRegister(
      { ...base, rawName: "山田太郎", displayNameInput: "山田 太郎" },
      "rider",
    );
    expect(plan.memberBody?.displayName).toBe("山田 太郎");
    // 表示名を整形しても突合キーは検出 nameKey のまま。
    expect(plan.memberBody?.athleteKey).toBe("山田太郎");
  });

  it("falls back to rawName when no input, then to nameKey", () => {
    expect(
      planQuickRegister({ ...base, rawName: "山田 太郎" }, "rider").memberBody
        ?.displayName,
    ).toBe("山田 太郎");
    expect(planQuickRegister(base, "rider").memberBody?.displayName).toBe(
      "山田太郎",
    );
  });

  it("treats a whitespace-only input as absent (falls through)", () => {
    const plan = planQuickRegister(
      { ...base, rawName: "山田 太郎", displayNameInput: "   " },
      "rider",
    );
    expect(plan.memberBody?.displayName).toBe("山田 太郎");
  });

  it("sets hasCar=true only when registering as driver", () => {
    expect(planQuickRegister(base, "driver").memberBody?.hasCar).toBe(true);
    expect(planQuickRegister(base, "rider").memberBody?.hasCar).toBe(false);
  });

  it("normalizes an empty className to null", () => {
    const plan = planQuickRegister({ ...base, className: "" }, "driver");
    expect(plan.className).toBeNull();
  });

  // --- R5: 運転手クイック登録の同乗可能人数（最小ステップ） ---

  it("includes seatsAvailable for a valid driver seats input", () => {
    const plan = planQuickRegister({ ...base, seatsInput: "3" }, "driver");
    expect(plan.memberBody?.seatsAvailable).toBe(3);
    expect(plan.memberBody?.hasCar).toBe(true);
  });

  it("accepts 0 seats (運転手だが同乗枠なし)", () => {
    const plan = planQuickRegister({ ...base, seatsInput: "0" }, "driver");
    expect(plan.memberBody?.seatsAvailable).toBe(0);
  });

  it("omits seatsAvailable for empty/invalid/out-of-range input", () => {
    for (const bad of ["", "  ", "abc", "-1", "21", "3.5", null, undefined]) {
      const plan = planQuickRegister(
        { ...base, seatsInput: bad as string | null | undefined },
        "driver",
      );
      expect(plan.memberBody).not.toBeNull();
      expect(plan.memberBody && "seatsAvailable" in plan.memberBody).toBe(false);
    }
  });

  it("ignores seats input for rider registration", () => {
    const plan = planQuickRegister({ ...base, seatsInput: "3" }, "rider");
    expect(plan.memberBody && "seatsAvailable" in plan.memberBody).toBe(false);
  });

  it("seats input does not affect existing-member plans", () => {
    const plan = planQuickRegister(
      { ...base, memberId: "m-1", seatsInput: "3" },
      "driver",
    );
    expect(plan.memberBody).toBeNull();
  });

  // --- B: 同乗者（passenger）クイック登録 = role rider + fixedDriverMemberId ---

  it("folds passenger into role='rider' and carries fixedDriverMemberId (existing member)", () => {
    const plan = planQuickRegister(
      { ...base, memberId: "m-1", fixedDriverMemberId: "drv-9" },
      "passenger",
    );
    expect(plan.memberBody).toBeNull();
    expect(plan.role).toBe("rider");
    expect(plan.fixedDriverMemberId).toBe("drv-9");
  });

  it("passenger for an unregistered entry creates a no-car member + carries driver", () => {
    const plan = planQuickRegister(
      { ...base, fixedDriverMemberId: "drv-9" },
      "passenger",
    );
    expect(plan.memberBody?.hasCar).toBe(false);
    expect(plan.memberBody?.athleteKey).toBe("山田太郎");
    expect(plan.role).toBe("rider");
    expect(plan.fixedDriverMemberId).toBe("drv-9");
  });

  it("passenger ignores seats input (only driver uses seats)", () => {
    const plan = planQuickRegister(
      { ...base, fixedDriverMemberId: "drv-9", seatsInput: "3" },
      "passenger",
    );
    expect(plan.memberBody && "seatsAvailable" in plan.memberBody).toBe(false);
  });

  it("passenger without a driver degrades to a plain rider (no fixedDriverMemberId)", () => {
    const plan = planQuickRegister({ ...base, memberId: "m-1" }, "passenger");
    expect(plan.role).toBe("rider");
    expect(plan.fixedDriverMemberId).toBeUndefined();
  });

  it("driver/rider plans never carry fixedDriverMemberId", () => {
    expect(planQuickRegister(base, "driver").fixedDriverMemberId).toBeUndefined();
    expect(planQuickRegister(base, "rider").fixedDriverMemberId).toBeUndefined();
  });
});
