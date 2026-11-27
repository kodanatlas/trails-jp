import { describe, expect, it } from "vitest";
import { buildBCandidates, displayClub, femalePaceFactor, isA21, paceBand } from "../b-candidates";
import type { JoaFirstRegistration, RaceResult } from "../types";

const joa = (firstFy: number): JoaFirstRegistration => ({ nameKey: "", firstFy, firstValidFrom: `${firstFy}-05-01` });

let seq = 0;
function race(e: number, c: number, className: string, key: string, sec: number, club = "筑波大学", date = "2026-06-01"): RaceResult {
  seq += 1;
  return {
    lcEventId: e, lcClassId: c, eventDate: date, eventName: `大会${e}`, className,
    runnerName: key, runnerKey: key, club, rank: seq, resultSec: sec,
  };
}

/** 大会 e: M21A(c=1, 5km)・W21A(c=2, 4km)・B(c=3, 2km)。B は 1km あたり 10,12,14,16 分 */
function event(e: number, extra: RaceResult[] = []) {
  const b = [600, 720, 840, 960].map((p, i) => race(e, 3, "B", `B${e}-${i}`, p * 2, "一般クラブ"));
  const m = [300, 310, 320].map((p, i) => race(e, 1, "M21A", `M${e}-${i}`, p * 5, "社会人OLC"));
  const w = [420, 440, 460].map((p, i) => race(e, 2, "W21A", `W${e}-${i}`, p * 4, "社会人OLC"));
  return [...b, ...m, ...w, ...extra];
}
const km = (e: number) => [
  { lcEventId: e, lcClassId: 1, km: 5 },
  { lcEventId: e, lcClassId: 2, km: 4 },
  { lcEventId: e, lcClassId: 3, km: 2 },
];

describe("isA21", () => {
  it("21A とその組分けだけ（年齢別 A・E・B は除く）", () => {
    expect(isA21("M21A")).toBe(true);
    expect(isA21("W21A2")).toBe(true);
    expect(isA21("M21AS")).toBe(true);
    expect(isA21("M20A")).toBe(false);
    expect(isA21("ME")).toBe(false);
    expect(isA21("B")).toBe(false);
  });
});

describe("displayClub", () => {
  it("所属名の末尾の組分けの数字だけ外す", () => {
    expect(displayClub("大阪大学2")).toBe("大阪大学");
    expect(displayClub("東北大OLC")).toBe("東北大OLC");
    expect(displayClub("")).toBe("");
  });
});

describe("paceBand", () => {
  it("B の中での位置を幅で返す", () => {
    expect(paceBand(0.3)).toBe("上位 25〜50%");
    expect(paceBand(0.6)).toBe("上位 50〜75%");
    expect(paceBand(0.8)).toBe("下位 25%");
  });
});

describe("femalePaceFactor", () => {
  it("W21A と M21A の上位 3 人のペースの比の中央値", () => {
    const f = femalePaceFactor(event(1), new Map(km(1).map((d) => [`${d.lcEventId}:${d.lcClassId}`, d.km])));
    expect(f).toBeCloseTo(440 / 310, 5);
  });
});

describe("buildBCandidates", () => {
  const base = { joa: new Map<string, JoaFirstRegistration>(), lcFirst: new Map<string, string>(), linkableKeys: new Set<string>(), currentFy: 2026, today: "2026-11-27" };

  it("2 大会以上で B の上位 25% に入らない 2 年目までの学生だけ載る", () => {
    // 学生 S: 1km 13 分 → B の 4 人中 2 人より遅い（50%）。2 大会とも
    const s = (e: number) => race(e, 1, "M21A", "S", 780 * 5);
    // 学生 F: 1km 11 分 → 4 人中 1 人より遅い（25%）＝線ちょうど（載る）
    const f = (e: number) => race(e, 1, "M21A", "F", 660 * 5);
    // 学生 Q: 1km 9 分 → B の誰より速い（0%）＝載らない
    const q = (e: number) => race(e, 1, "M21A", "Q", 540 * 5);
    // 学生 O: 遅いが 1 大会だけ
    const o = race(1, 1, "M21A", "O", 900 * 5);
    // 学生 V: 遅いが競技 3 年目
    const v = (e: number) => race(e, 1, "M21A", "V", 900 * 5);
    const results = [...event(1, [s(1), f(1), q(1), o, v(1)]), ...event(2, [s(2), f(2), q(2), v(2)])];
    const distances = [...km(1), ...km(2)];
    const joaMap = new Map([["S", joa(2025)], ["F", joa(2026)], ["Q", joa(2025)], ["O", joa(2025)], ["V", joa(2024)]]);
    const out = buildBCandidates({ ...base, results, distances, joa: joaMap });
    expect(out.map((x) => x.nameKey).sort()).toEqual(["F", "S"]);
    const sEntry = out.find((x) => x.nameKey === "S")!;
    expect(sEntry.year).toBe(2);
    expect(sEntry.races).toBe(2);
    expect(sEntry.band).toBe("上位 50〜75%");
    expect(out.find((x) => x.nameKey === "F")!.band).toBe("上位 25〜50%");
  });

  it("女子は男女のペースの比で補正してから比べる", () => {
    // 女子 W: 1km 約 13.7 分。補正なしなら B の 2 人より遅い（50%）だが、
    // 補正（÷ 440/310）すると約 9.6 分 → B の誰より速い（0%）＝載らない
    const w = (e: number) => race(e, 2, "W21A", "W", 820 * 4);
    const results = [...event(1, [w(1)]), ...event(2, [w(2)])];
    const out = buildBCandidates({ ...base, results, distances: [...km(1), ...km(2)], joa: new Map([["W", joa(2026)]]) });
    expect(out).toEqual([]);
  });

  it("学生でない人・距離が無い大会・B が 4 人未満の大会・12 か月より前の大会は使わない", () => {
    const g = (e: number) => race(e, 1, "M21A", "G", 900 * 5, "社会人OLC");
    const old = (e: number) => race(e, 1, "M21A", "S", 900 * 5, "筑波大学", "2025-10-01");
    const results = [
      ...event(1, [g(1)]), ...event(2, [g(2)]),
      // 大会 3 は距離なし、大会 4 は 12 か月より前
      ...event(3, [race(3, 1, "M21A", "S", 900 * 5)]),
      ...event(4, [old(4)]).map((r) => ({ ...r, eventDate: "2025-10-01" })),
    ];
    const out = buildBCandidates({
      ...base, results, distances: [...km(1), ...km(2), ...km(4)],
      joa: new Map([["G", joa(2026)], ["S", joa(2026)]]),
    });
    expect(out).toEqual([]);
  });

  it("大学→中高、同じ区分は所属ごとにまとめる", () => {
    const mk = (key: string, club: string) => (e: number) => race(e, 1, "M21A", key, 900 * 5, club);
    const a = mk("あべ", "筑波大学"), b = mk("いとう", "筑波大学"), c = mk("うえだ", "開成高校");
    const results = [...event(1, [a(1), b(1), c(1)]), ...event(2, [a(2), b(2), c(2)])];
    const j = new Map([["あべ", joa(2026)], ["いとう", joa(2026)], ["うえだ", joa(2026)]]);
    const out = buildBCandidates({ ...base, results, distances: [...km(1), ...km(2)], joa: j });
    expect(out.map((x) => x.nameKey)).toEqual(["あべ", "いとう", "うえだ"]);
    expect(out.map((x) => x.affiliation)).toEqual(["大学", "大学", "中高"]);
  });
});
