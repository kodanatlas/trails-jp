import { describe, it, expect } from "vitest";
import { dedupeTravelTimeEntries } from "../api/helpers";

/**
 * dedupeTravelTimeEntries（純粋関数）のテスト。
 * 同一 (fromNodeId, toNodeId, mode) は後勝ちで1件化する。
 */
describe("dedupeTravelTimeEntries", () => {
  const A = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
  const B = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
  const C = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";

  it("同一キーは後勝ちで1件化する", () => {
    const out = dedupeTravelTimeEntries([
      { fromNodeId: A, toNodeId: B, mode: "car", minutes: 10 },
      { fromNodeId: A, toNodeId: B, mode: "car", minutes: 25 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].minutes).toBe(25); // 後勝ち
  });

  it("異なるキーは保持する", () => {
    const out = dedupeTravelTimeEntries([
      { fromNodeId: A, toNodeId: B, mode: "car", minutes: 10 },
      { fromNodeId: A, toNodeId: B, mode: "transit", minutes: 40 }, // mode 違い
      { fromNodeId: A, toNodeId: C, mode: "car", minutes: 15 }, // to 違い
      { fromNodeId: B, toNodeId: A, mode: "car", minutes: 12 }, // 方向違い
    ]);
    expect(out).toHaveLength(4);
  });

  it("空配列は空配列を返す", () => {
    expect(dedupeTravelTimeEntries([])).toEqual([]);
  });

  it("混在（重複＋ユニーク）でユニーク数に潰れる", () => {
    const out = dedupeTravelTimeEntries([
      { fromNodeId: A, toNodeId: B, mode: "car", minutes: 10 },
      { fromNodeId: A, toNodeId: C, mode: "car", minutes: 15 },
      { fromNodeId: A, toNodeId: B, mode: "car", minutes: 99 }, // 1件目と同キー
    ]);
    expect(out).toHaveLength(2);
    const ab = out.find((e) => e.toNodeId === B);
    expect(ab?.minutes).toBe(99);
  });
});
