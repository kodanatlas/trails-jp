import { describe, it, expect } from "vitest";
import {
  planBulkParticipations,
  indexMembersByKey,
  chunkBulkEntries,
} from "../bulk-plan";
import { normalizeNameKey } from "../../name-key";

interface Row {
  memberId: string;
  className: string | null;
}

const r = (memberId: string, className: string | null = null): Row => ({
  memberId,
  className,
});

describe("planBulkParticipations (pure)", () => {
  it("inserts entries whose member has no existing participation", () => {
    const plan = planBulkParticipations(
      [r("a"), r("b"), r("c")],
      new Set<string>(),
    );
    expect(plan.toInsert.map((x) => x.memberId)).toEqual(["a", "b", "c"]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips entries whose member already has a participation (no role overwrite)", () => {
    const plan = planBulkParticipations(
      [r("a"), r("b"), r("c")],
      new Set<string>(["b"]),
    );
    expect(plan.toInsert.map((x) => x.memberId)).toEqual(["a", "c"]);
    expect(plan.skipped.map((x) => x.memberId)).toEqual(["b"]);
  });

  it("skips all when every member already participates", () => {
    const plan = planBulkParticipations(
      [r("a"), r("b")],
      new Set<string>(["a", "b"]),
    );
    expect(plan.toInsert).toEqual([]);
    expect(plan.skipped.map((x) => x.memberId)).toEqual(["a", "b"]);
  });

  it("dedupes repeated memberIds within the batch (first wins)", () => {
    const plan = planBulkParticipations(
      [r("a", "M21A"), r("a", "M35A"), r("b")],
      new Set<string>(),
    );
    // a は 1 件のみ（先勝ち = className M21A）。
    expect(plan.toInsert.map((x) => x.memberId)).toEqual(["a", "b"]);
    expect(plan.toInsert[0].className).toBe("M21A");
  });

  it("a duplicate that is also existing goes to skipped once", () => {
    const plan = planBulkParticipations(
      [r("a"), r("a")],
      new Set<string>(["a"]),
    );
    expect(plan.toInsert).toEqual([]);
    expect(plan.skipped.map((x) => x.memberId)).toEqual(["a"]);
  });

  it("preserves className on inserted rows", () => {
    const plan = planBulkParticipations([r("a", "W21A")], new Set<string>());
    expect(plan.toInsert[0].className).toBe("W21A");
  });

  it("handles an empty input", () => {
    const plan = planBulkParticipations([], new Set<string>());
    expect(plan.toInsert).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });
});

describe("indexMembersByKey (重複作成防止の最後の砦・指摘1)", () => {
  it("indexes by normalizeNameKey(athleteKey)", () => {
    const idx = indexMembersByKey([
      { id: "m1", athleteKey: normalizeNameKey("田中一郎"), displayName: "田中一郎" },
    ]);
    // bulk の newMember.athleteKey は検出 nameKey（正準済み）。同じキーで引ける。
    expect(idx.get(normalizeNameKey("田中一郎"))).toBe("m1");
  });

  it("falls back to displayName key when athleteKey is null", () => {
    // 自己登録で athlete_key を持たない member でも displayName から再利用先を引ける。
    const idx = indexMembersByKey([
      { id: "m1", athleteKey: null, displayName: "田中一郎" },
    ]);
    expect(idx.get(normalizeNameKey("田中一郎"))).toBe("m1");
  });

  it("folds spacing/width differences via NFKC + space strip", () => {
    const idx = indexMembersByKey([
      { id: "m1", athleteKey: null, displayName: "田中　一郎" },
    ]);
    // エントリー側キー（スペースなし）でヒットする。
    expect(idx.get(normalizeNameKey("田中一郎"))).toBe("m1");
  });

  it("prefers athleteKey owner over displayName owner on key collision", () => {
    // 同じ正準キーに athlete_key 持ちと displayName のみの member が居る場合、athlete_key 側を採用。
    const key = normalizeNameKey("田中一郎");
    const idx = indexMembersByKey([
      { id: "by-name", athleteKey: null, displayName: "田中一郎" },
      { id: "by-key", athleteKey: key, displayName: "別表示" },
    ]);
    expect(idx.get(key)).toBe("by-key");
  });

  it("is first-wins for duplicate athleteKeys (determinism)", () => {
    const key = normalizeNameKey("田中一郎");
    const idx = indexMembersByKey([
      { id: "first", athleteKey: key, displayName: "田中一郎" },
      { id: "second", athleteKey: key, displayName: "田中一郎" },
    ]);
    expect(idx.get(key)).toBe("first");
  });

  it("ignores empty/null keys", () => {
    const idx = indexMembersByKey([
      { id: "m1", athleteKey: null, displayName: null },
      { id: "m2", athleteKey: "   ", displayName: "" },
    ]);
    expect(idx.size).toBe(0);
  });

  it("returns a key not present when no member matches (reuse miss → will create)", () => {
    const idx = indexMembersByKey([
      { id: "m1", athleteKey: null, displayName: "別人花子" },
    ]);
    expect(idx.has(normalizeNameKey("田中一郎"))).toBe(false);
  });
});

describe("chunkBulkEntries (m2: 30件上限のチャンク分割)", () => {
  const seq = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

  it("returns [] for empty input", () => {
    expect(chunkBulkEntries([])).toEqual([]);
  });

  it("keeps 1..30 entries in a single chunk (default size = bulk limit 30)", () => {
    expect(chunkBulkEntries(seq(1))).toEqual([[0]]);
    const c30 = chunkBulkEntries(seq(30));
    expect(c30).toHaveLength(1);
    expect(c30[0]).toHaveLength(30);
  });

  it("splits 31 entries into [30, 1] (no silent truncation)", () => {
    const chunks = chunkBulkEntries(seq(31));
    expect(chunks.map((c) => c.length)).toEqual([30, 1]);
  });

  it("splits 61 entries into [30, 30, 1]", () => {
    const chunks = chunkBulkEntries(seq(61));
    expect(chunks.map((c) => c.length)).toEqual([30, 30, 1]);
  });

  it("preserves input order across chunks (lossless flatten)", () => {
    const input = seq(65);
    const flat = chunkBulkEntries(input).flat();
    expect(flat).toEqual(input);
  });

  it("honors an explicit chunk size", () => {
    expect(chunkBulkEntries(seq(5), 2).map((c) => c.length)).toEqual([2, 2, 1]);
  });

  it("falls back to a single chunk for an invalid size (loses nothing)", () => {
    expect(chunkBulkEntries(seq(3), 0)).toEqual([[0, 1, 2]]);
  });
});
