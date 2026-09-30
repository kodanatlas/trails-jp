import { describe, it, expect } from "vitest";
import { resolveDriftedClassId } from "../class-id-drift";

// 中高選手権 個人（ev=9974）の実例: 取込時 AL1=12 → 再掲載後 AL1=6・12 は学校対抗
const now = [
  { classId: 6, className: "AL1" },
  { classId: 7, className: "AL2" },
  { classId: 12, className: "埼玉県立浦和高等学校" },
];

describe("resolveDriftedClassId（mulka2 のクラスID の振り直しをクラス名で引き直す）", () => {
  it("今の ID のクラス名が違い、同名のクラスが 1 つあれば、その ID を返す", () => {
    expect(resolveDriftedClassId(now, 12, "AL1")).toBe(6);
  });
  it("名前が一致していれば null（そのまま開く）", () => {
    expect(resolveDriftedClassId(now, 6, "AL1")).toBeNull();
  });
  it("元の ID がもう無いときも、同名のクラスへ引き直す", () => {
    expect(resolveDriftedClassId(now, 40, "AL2")).toBe(7);
  });
  it("同名のクラスが無い・複数ある（決められない）・cn なしは null", () => {
    expect(resolveDriftedClassId(now, 12, "M21A")).toBeNull();
    const dup = [...now, { classId: 20, className: "AL1" }];
    expect(resolveDriftedClassId(dup, 12, "AL1")).toBeNull();
    expect(resolveDriftedClassId(now, 12, null)).toBeNull();
    expect(resolveDriftedClassId(now, 12, "")).toBeNull();
  });
  it("クラス一覧が取れなかった（空）ときは null", () => {
    expect(resolveDriftedClassId([], 12, "AL1")).toBeNull();
  });
});
