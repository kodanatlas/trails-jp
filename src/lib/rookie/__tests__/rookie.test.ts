import { describe, expect, it } from "vitest";
import { affiliationOf, classTier, fiscalYear, rookieStatus, startFyWithRescue } from "../rules";
import { buildRookieTable, scoreRaces } from "../scoring";
import { firstRegistrations, mergeCurrentFy, parseRosterCsv, snapshotDate } from "../joa-roster";
import type { JoaFirstRegistration, RaceResult } from "../types";

describe("classTier", () => {
  it("B は許可リストだけ（年齢別 B・組分け -B は除く）", () => {
    expect(classTier("B")).toBe("B");
    expect(classTier("MB")).toBe("B");
    expect(classTier("男子B")).toBe("B");
    expect(classTier("M12B")).toBeNull();
    expect(classTier("M21A-B")).toBe("A");
  });
  it("A は一般向けのみ（M20A・M50A は除く）", () => {
    expect(classTier("M21A")).toBe("A");
    expect(classTier("W21A2")).toBe("A");
    expect(classTier("AL1")).toBe("A");
    expect(classTier("M20A")).toBeNull();
    expect(classTier("M50A")).toBeNull();
    expect(classTier("ME")).toBe("E");
    expect(classTier("M21E")).toBe("E");
    expect(classTier("N")).toBeNull();
  });
});

describe("年度と救済", () => {
  it("年度は 4 月始まり", () => {
    expect(fiscalYear("2026-03-31")).toBe(2025);
    expect(fiscalYear("2026-04-01")).toBe(2026);
  });
  it("1〜3 月に始まった人は翌年度を 1 年目にする", () => {
    expect(startFyWithRescue(2025, "2026-02-10")).toBe(2026);
    expect(startFyWithRescue(2025, "2025-12-20")).toBe(2025);
    expect(startFyWithRescue(2025, "2025-04-01")).toBe(2025);
    expect(startFyWithRescue(2025, null)).toBe(2025);
  });
});

const joa = (firstFy: number, firstValidFrom: string | null = `${firstFy}-04-01`): JoaFirstRegistration => ({
  nameKey: "x",
  firstFy,
  firstValidFrom,
});

describe("rookieStatus", () => {
  it("JOA 初登録 FY2025 は新人（1 年目 = FY2025）", () => {
    expect(rookieStatus("山田太郎", joa(2025), "2025-05-01", "東大OLK")).toEqual({ kind: "rookie", source: "JOA", startFy: 2025 });
  });
  it("FY2019 の名簿にいる人は対象外", () => {
    expect(rookieStatus("山田太郎", joa(2019), "2019-05-01", null)).toEqual({ kind: "excluded", reason: "veteran" });
  });
  it("初登録より 2 年以上前から LapCenter にいる人は復帰者として外す", () => {
    expect(rookieStatus("山田太郎", joa(2025), "2023-06-01", null)).toEqual({ kind: "excluded", reason: "returner" });
    expect(rookieStatus("山田太郎", joa(2025), "2024-06-01", null).kind).toBe("rookie");
  });
  it("同姓同名を分けたキーは外す", () => {
    expect(rookieStatus("鈴木健太（筑波大学）", undefined, "2025-05-01", null)).toEqual({ kind: "excluded", reason: "homonym" });
  });
  it("未登録は LapCenter の初出年度で数え、英字だけの所属は海外として外す", () => {
    expect(rookieStatus("佐藤花子", undefined, "2025-06-01", "わりかし小径車の会")).toEqual({ kind: "rookie", source: "未登録", startFy: 2025 });
    expect(rookieStatus("AnnaX", undefined, "2025-06-01", "Nydalens Skiklub")).toEqual({ kind: "excluded", reason: "foreign" });
    expect(rookieStatus("佐藤花子", undefined, "2019-06-01", null)).toEqual({ kind: "excluded", reason: "veteran" });
  });
  it("年度後半に登録した人は救済される", () => {
    expect(rookieStatus("山田太郎", joa(2025, "2026-01-15"), "2026-01-20", null)).toEqual({ kind: "rookie", source: "JOA", startFy: 2026 });
  });
});

describe("affiliationOf", () => {
  it("高校名に「大学」を含んでも中高", () => {
    expect(affiliationOf("東京農業大学第三高等学校")).toBe("中高");
    expect(affiliationOf("北大OLC")).toBe("大学");
    expect(affiliationOf("入間市OLC")).toBe("一般");
    expect(affiliationOf(null)).toBe("一般");
  });
});

let seq = 0;
function race(p: Partial<RaceResult> & { runnerKey: string; resultSec: number; lcClassId: number }): RaceResult {
  seq += 1;
  return {
    lcEventId: 1,
    eventDate: "2025-06-01",
    eventName: "テスト大会",
    className: "B",
    runnerName: p.runnerKey,
    club: null,
    rank: seq,
    ...p,
  };
}

describe("scoreRaces", () => {
  it("4 人未満のクラスは使わない", () => {
    const rs = [1, 2, 3].map((i) => race({ runnerKey: `r${i}`, resultSec: 1000 + i, lcClassId: 9 }));
    expect(scoreRaces(rs).size).toBe(0);
  });
  it("基準は上位 3 人の平均・上限 1.05・n/(n+2)", () => {
    const rs = [900, 1000, 1100, 1200].map((s, i) => race({ runnerKey: `r${i}`, resultSec: s, lcClassId: 8 }));
    const m = scoreRaces(rs);
    const ref = (900 + 1000 + 1100) / 3;
    expect(m.get("r0")![0].ratio).toBeCloseTo(Math.min(ref / 900, 1.05));
    expect(m.get("r3")![0].points).toBeCloseTo((ref / 1200) * (4 / 6));
  });
  it("順位やタイムが無い出走は数えない", () => {
    const rs = [
      ...[900, 1000, 1100, 1200].map((s, i) => race({ runnerKey: `r${i}`, resultSec: s, lcClassId: 7 })),
      race({ runnerKey: "dq", resultSec: 800, lcClassId: 7, rank: null }),
    ];
    expect(scoreRaces(rs).has("dq")).toBe(false);
  });
});

describe("buildRookieTable", () => {
  const field = (cls: number, date: string, className: string, keys: string[], base = 1000) =>
    keys.map((k, i) => race({ runnerKey: k, resultSec: base + i * 100, lcClassId: cls, eventDate: date, className }));
  const joaMap = new Map<string, JoaFirstRegistration>([
    ["新人A", { nameKey: "新人A", firstFy: 2025, firstValidFrom: "2025-04-01" }],
    ["新人B", { nameKey: "新人B", firstFy: 2024, firstValidFrom: "2024-04-01" }],
    ["古参", { nameKey: "古参", firstFy: 2019, firstValidFrom: "2019-04-01" }],
    ["三年目", { nameKey: "三年目", firstFy: 2023, firstValidFrom: "2023-04-01" }],
  ]);
  const lcFirst = new Map([
    ["新人A", "2025-05-01"],
    ["新人B", "2024-05-01"],
    ["古参", "2019-05-01"],
    ["三年目", "2023-05-01"],
    ["未登録C", "2025-05-01"],
  ]);
  const keys = ["新人A", "新人B", "古参", "三年目", "未登録C"];

  it("2 年目までの新人だけが載り、上位 2 戦の平均（足りない分は 0）で並ぶ", () => {
    const results = [...field(1, "2025-06-01", "B", keys), ...field(2, "2025-07-01", "MB", ["新人B", "新人A", "古参", "三年目", "未登録C"])];
    const t = buildRookieTable({ fy: 2025, results, joa: joaMap, lcFirst, linkableKeys: new Set(["新人A"]) });
    expect(t.map((r) => r.nameKey).sort()).toEqual(["新人A", "新人B", "未登録C"]);
    const a = t.find((r) => r.nameKey === "新人A")!;
    expect(a.year).toBe(1);
    expect(a.bRaces).toBe(2);
    expect(a.linkable).toBe(true);
    expect(t.find((r) => r.nameKey === "新人B")!.year).toBe(2);
    expect(t.find((r) => r.nameKey === "未登録C")!.source).toBe("未登録");
    expect(t[0].rank).toBe(1);
  });

  it("A で素の比 0.85 以上（20 人以上）を出したら、その日から後の B は数えない", () => {
    const big = Array.from({ length: 20 }, (_, i) => (i === 0 ? "新人A" : `他${i}`));
    const results = [
      ...field(1, "2025-06-01", "B", keys),
      ...field(3, "2025-07-01", "M21A", big),
      ...field(4, "2025-08-01", "B", keys),
    ];
    const t = buildRookieTable({ fy: 2025, results, joa: joaMap, lcFirst, linkableKeys: new Set() });
    const a = t.find((r) => r.nameKey === "新人A")!;
    expect(a.graduated).toBe(true);
    expect(a.bRaces).toBe(1);
    expect(a.best[0].date).toBe("2025-06-01");
  });

  it("他年度の出走は混ざらない", () => {
    const t = buildRookieTable({ fy: 2026, results: field(1, "2025-06-01", "B", keys), joa: joaMap, lcFirst, linkableKeys: new Set() });
    expect(t).toEqual([]);
  });
});

describe("JOA 名簿", () => {
  const csv = '"番号"\t"氏名"\t"登録都道府県"\t"ふるさと登録都道府県"\t"登録日"\t"有効化日"\t"失効日"\n"1-27-1"\t"山田　太郎"\t"東京都"\t""\t"2026-02-01"\t"2026-04-01"\t"2027-06-30"\n';
  it("氏名キー（空白除去）と有効化日を取り出す", () => {
    expect(parseRosterCsv(csv)).toEqual([{ nameKey: "山田太郎", validFrom: "2026-04-01" }]);
  });
  it("氏名列が無ければ失敗にする", () => {
    expect(() => parseRosterCsv('"番号"\t"x"\n"1"\t"2"\n')).toThrow();
  });
  it("初登録は最も古い年度、今年度の分は足すだけ", () => {
    const byFy = new Map([
      [2024, [{ nameKey: "a", validFrom: "2024-04-01" }]],
      [2025, [{ nameKey: "a", validFrom: "2025-04-01" }, { nameKey: "b", validFrom: "2026-01-10" }]],
    ]);
    const f = firstRegistrations(byFy);
    expect(f.get("a")!.firstFy).toBe(2024);
    expect(f.get("b")).toEqual({ nameKey: "b", firstFy: 2025, firstValidFrom: "2026-01-10" });
    const m = mergeCurrentFy(f, 2026, [{ nameKey: "a", validFrom: "2026-04-01" }, { nameKey: "c", validFrom: "2026-05-01" }]);
    expect(m.get("a")!.firstFy).toBe(2024);
    expect(m.get("c")!.firstFy).toBe(2026);
  });
  it("名簿の有効日は過去の年度なら年度末、今年度なら今日", () => {
    expect(snapshotDate(2024, "2026-11-27")).toBe("2025-03-31");
    expect(snapshotDate(2026, "2026-11-27")).toBe("2026-11-27");
  });
});
