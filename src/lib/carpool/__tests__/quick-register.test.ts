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
});
