import { describe, it, expect } from "vitest";
import { buildApplyTargets } from "../apply-plan";
import type { StartlistMatch } from "../match";

const base: StartlistMatch = {
  startTime: "10:45",
  className: "M21A",
  rawName: "山田 太郎",
  affiliation: "入間市OLC",
  memberId: "m1",
  confidence: "exact",
};
const m = (over: Partial<StartlistMatch> = {}): StartlistMatch => ({ ...base, ...over });
const parts = new Set(["m1", "m2"]);

describe("buildApplyTargets (B1: 列ごとの部分更新)", () => {
  it("match 値が空で override も無い列は undefined（UPDATE 対象外＝手入力値を潰さない）", () => {
    const { targets, skipped } = buildApplyTargets([m({ startTime: "" })], [], parts);
    expect(skipped).toHaveLength(0);
    expect(targets).toHaveLength(1);
    expect(targets[0]).not.toHaveProperty("startTime");
    expect(targets[0].className).toBe("M21A");
  });

  it("className が空でも対称に undefined", () => {
    const { targets } = buildApplyTargets([m({ className: "" })], [], parts);
    expect(targets[0]).not.toHaveProperty("className");
    expect(targets[0].startTime).toBe("10:45");
  });

  it("override の明示 null はクリアとして通る", () => {
    const { targets } = buildApplyTargets(
      [m()],
      [{ memberId: "m1", startTime: null }],
      parts,
    );
    expect(targets[0].startTime).toBeNull();
    expect(targets[0].className).toBe("M21A");
  });

  it("override の文字列は match 値より優先される", () => {
    const { targets } = buildApplyTargets(
      [m()],
      [{ memberId: "m1", startTime: "12:34", className: "M21AS" }],
      parts,
    );
    expect(targets[0].startTime).toBe("12:34");
    expect(targets[0].className).toBe("M21AS");
  });

  it("match 値が空でも override があればその値を使う", () => {
    const { targets } = buildApplyTargets(
      [m({ startTime: "" })],
      [{ memberId: "m1", startTime: "09:30" }],
      parts,
    );
    expect(targets[0].startTime).toBe("09:30");
  });

  it("両列とも反映する値が無い行は skipped（反映する値がありません）", () => {
    const { targets, skipped } = buildApplyTargets(
      [m({ startTime: "", className: "" })],
      [],
      parts,
    );
    expect(targets).toHaveLength(0);
    expect(skipped).toEqual([
      { rawName: "山田 太郎", className: "", reason: "反映する値がありません" },
    ]);
  });
});

describe("buildApplyTargets (M1: surname は override＝ユーザー確認が必須)", () => {
  it("surname 行は override が無ければ skipped（既定で反映対象外）", () => {
    const { targets, skipped } = buildApplyTargets(
      [m({ confidence: "surname" })],
      [],
      parts,
    );
    expect(targets).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toBe("姓のみ一致（未確認のため反映されません）");
  });

  it("surname 行は override があれば反映対象になる", () => {
    const { targets, skipped } = buildApplyTargets(
      [m({ confidence: "surname" })],
      [{ memberId: "m1", startTime: "10:45", className: "M21A" }],
      parts,
    );
    expect(skipped).toHaveLength(0);
    expect(targets).toHaveLength(1);
    expect(targets[0].memberId).toBe("m1");
    expect(targets[0].startTime).toBe("10:45");
  });
});

describe("buildApplyTargets (既存セマンティクスの回帰)", () => {
  it("none 行は メンバー未特定 / 未参加 member は 未参加登録", () => {
    const { targets, skipped } = buildApplyTargets(
      [
        m({ memberId: null, confidence: "none", rawName: "不 明" }),
        m({ memberId: "outsider", rawName: "外 部" }),
      ],
      [],
      parts,
    );
    expect(targets).toHaveLength(0);
    expect(skipped.map((s) => s.reason)).toEqual(["メンバー未特定", "未参加登録"]);
  });

  it("同一 member の重複行は先勝ちで 1 件化", () => {
    const { targets } = buildApplyTargets(
      [m({ startTime: "10:00" }), m({ startTime: "11:00" })],
      [],
      parts,
    );
    expect(targets).toHaveLength(1);
    expect(targets[0].startTime).toBe("10:00");
  });
});
