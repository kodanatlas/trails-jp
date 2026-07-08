import { describe, it, expect } from "vitest";
import { buildLegH2H, type LegH2HRow } from "../leg-h2h";

function row(
  eid: number,
  cid: number,
  key: string,
  laps: (number | null)[],
  opts: { date?: string; event?: string; className?: string; type?: "forest" | "sprint" } = {},
): LegH2HRow {
  return {
    lc_event_id: eid,
    lc_class_id: cid,
    event_date: opts.date ?? "2026-01-01",
    event_name: opts.event ?? "大会",
    class_name: opts.className ?? "M21E",
    race_type: opts.type ?? "forest",
    runner_key: key,
    lap_sec: laps,
  };
}

describe("buildLegH2H", () => {
  it("同一クラスのレッグ毎に速い方を勝ちに集計", () => {
    const rows = [
      row(1, 0, "自分", [100, 120, 90]), // leg0 win, leg1 lose, leg2 win
      row(1, 0, "相手", [110, 115, 95]),
    ];
    const r = buildLegH2H(rows, "自分", "相手");
    expect(r.races).toHaveLength(1);
    expect(r.wonA).toBe(2);
    expect(r.wonB).toBe(1);
    expect(r.legs).toBe(3);
    expect(r.races[0].wonA).toBe(2);
  });

  it("別クラス（別コース）は比較しない", () => {
    const rows = [
      row(1, 0, "自分", [100, 120]),
      row(1, 5, "相手", [110, 115]), // 同一大会・別クラス
    ];
    const r = buildLegH2H(rows, "自分", "相手");
    expect(r.races).toHaveLength(0);
    expect(r.legs).toBe(0);
  });

  it("null/非正のレッグは比較対象外", () => {
    const rows = [
      row(1, 0, "自分", [100, null, 90, 0]),
      row(1, 0, "相手", [110, 115, null, 80]),
    ];
    const r = buildLegH2H(rows, "自分", "相手");
    expect(r.legs).toBe(1); // leg0 のみ両者有効
    expect(r.wonA).toBe(1);
  });

  it("同タイムは引き分け", () => {
    const rows = [row(1, 0, "自分", [100, 100]), row(1, 0, "相手", [100, 90])];
    const r = buildLegH2H(rows, "自分", "相手");
    expect(r.tied).toBe(1);
    expect(r.wonB).toBe(1);
  });

  it("複数レースを日付降順で集約", () => {
    const rows = [
      row(1, 0, "自分", [100, 100], { date: "2025-06-01", event: "旧" }),
      row(1, 0, "相手", [110, 110], { date: "2025-06-01", event: "旧" }),
      row(2, 0, "自分", [90], { date: "2026-06-01", event: "新" }),
      row(2, 0, "相手", [95], { date: "2026-06-01", event: "新" }),
    ];
    const r = buildLegH2H(rows, "自分", "相手");
    expect(r.races).toHaveLength(2);
    expect(r.races[0].eventName).toBe("新"); // 降順
    expect(r.wonA).toBe(3);
  });

  it("片方しか居ないレース・同名は空", () => {
    expect(buildLegH2H([row(1, 0, "自分", [100])], "自分", "相手").races).toHaveLength(0);
    expect(buildLegH2H([row(1, 0, "自分", [100])], "自分", "自分")).toEqual({
      races: [],
      wonA: 0,
      wonB: 0,
      tied: 0,
      legs: 0,
    });
  });
});
