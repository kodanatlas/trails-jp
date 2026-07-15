import { describe, it, expect } from "vitest";
import {
  toHhmm,
  toLocalDate,
  toDuration,
  personKey,
  normalize,
  countConfirmedStarts,
  countEntries,
  type RawResult,
} from "../normalize";
import type { OringenRace } from "../types";

const races: OringenRace[] = [
  { n: 1, raceId: 124, date: "2026-07-20" },
  { n: 2, raceId: 125, date: "2026-07-21" },
];
const classNames = { 3968: "H40", 3974: "D21 Lång", 9999: "H21" };
const distances = { "124:3968": 6880, "125:3968": 6790 };
const nameMap = { "Kodama Takeshi": { kanji: "児玉健", confidence: "high" as const } };

function jpn(over: Partial<RawResult> = {}): RawResult {
  return {
    p: { f: "Takeshi", l: "Kodama", b: 1984, s: "M", n: "other" },
    o: { i: 668, ei: "2748", n: "Irumashi OLC", c: "JPN" },
    c: { i: 3968 },
    r: 124,
    e: 2295,
    st: "2026-07-20T08:22:00",
    ...over,
  };
}

describe("toHhmm — API の st は UTC", () => {
  // 2026-07-15 の実害バグの回帰テスト。公式 competitors ページの実測値と突合している。
  // 生値をそのまま出すと2時間早くなり、5日間ずっと2時間早く会場に行くことになる。
  it.each([
    ["2026-07-20T08:22:00", "10:22"],
    ["2026-07-21T10:13:00", "12:13"],
    ["2026-07-23T11:09:00", "13:09"],
    ["2026-07-24T07:00:00", "09:00"],
  ])("%s (UTC) → Europe/Stockholm の %s（公式の実測値）", (utc, expected) => {
    expect(toHhmm(utc)).toBe(expected);
  });

  it("生値をそのまま返さない（バグの再発検知）", () => {
    expect(toHhmm("2026-07-20T08:22:00")).not.toBe("08:22");
  });

  it("Z 付き・オフセット付きも正しく扱う", () => {
    expect(toHhmm("2026-07-20T08:22:00Z")).toBe("10:22");
    expect(toHhmm("2026-07-20T10:22:00+02:00")).toBe("10:22");
  });

  it("冬時間は +1（オフセットをハードコードしていないこと）", () => {
    expect(toHhmm("2026-01-15T08:22:00")).toBe("09:22");
  });

  it("欠落・不正値は null", () => {
    expect(toHhmm(undefined)).toBeNull();
    expect(toHhmm(null)).toBeNull();
    expect(toHhmm("")).toBeNull();
    expect(toHhmm("not-a-date")).toBeNull();
  });
});

describe("toLocalDate", () => {
  it("race.st(UTC) から現地日付を切る", () => {
    expect(toLocalDate("2026-07-20T04:00:00")).toBe("2026-07-20");
  });
  it("日跨ぎ: 22:30 UTC は現地で翌日", () => {
    expect(toLocalDate("2026-07-20T22:30:00")).toBe("2026-07-21");
  });
});

describe("toDuration", () => {
  it("秒を H:MM:SS にする", () => {
    expect(toDuration(3661)).toBe("1:01:01");
    expect(toDuration(59)).toBe("0:00:59");
  });
  it("0・負・null は null（0 は未計測であって 0 秒完走ではない）", () => {
    expect(toDuration(0)).toBeNull();
    expect(toDuration(-1)).toBeNull();
    expect(toDuration(null)).toBeNull();
  });
});

describe("personKey", () => {
  it("姓 名 を返す", () => {
    expect(personKey(jpn())).toBe("Kodama Takeshi");
  });
  it("元データの表記ゆれを補正する（Tanak → Tanaka）", () => {
    expect(personKey(jpn({ p: { f: "Masataka", l: "Tanak" } }))).toBe("Tanaka Masataka");
  });
  it("姓名が欠けたら null", () => {
    expect(personKey(jpn({ p: { f: "Takeshi" } }))).toBeNull();
  });
});

describe("normalize", () => {
  const base = { races, classNames, distances, nameMap };

  it("日本クラブ所属のみ抽出する", () => {
    const people = normalize({
      ...base,
      raws: [jpn(), jpn({ o: { n: "OK Orion", c: "SWE" }, p: { f: "Erik", l: "Svensson" } })],
    });
    expect(people).toHaveLength(1);
    expect(people[0]!.name).toBe("Kodama Takeshi");
  });

  it("生年を持ち込まない（公開しない方針をコードで固定）", () => {
    const people = normalize({ ...base, raws: [jpn()] });
    expect(JSON.stringify(people)).not.toContain("1984");
    expect(people[0]).not.toHaveProperty("birthYear");
  });

  it("漢字を対応表から引き当てる", () => {
    const people = normalize({ ...base, raws: [jpn()] });
    expect(people[0]!.kanji).toBe("児玉健");
    expect(people[0]!.kanjiConfidence).toBe("high");
  });

  it("対応表に無ければ kanji は null（推測しない）", () => {
    const people = normalize({ ...base, raws: [jpn({ p: { f: "Masao", l: "Suzuki" } })] });
    expect(people[0]!.kanji).toBeNull();
  });

  it("startTime を現地時間に変換して入れる", () => {
    const people = normalize({ ...base, raws: [jpn()] });
    expect(people[0]!.entries["1"]![0]!.startTime).toBe("10:22");
  });

  it("未抽選（st なし）は null", () => {
    const people = normalize({ ...base, raws: [jpn({ st: undefined })] });
    expect(people[0]!.entries["1"]![0]!.startTime).toBeNull();
  });

  it("削除済みエントリーを除外する", () => {
    const people = normalize({ ...base, raws: [jpn({ d: true })] });
    expect(people).toHaveLength(0);
  });

  it("距離を引き当てる", () => {
    const people = normalize({ ...base, raws: [jpn()] });
    expect(people[0]!.entries["1"]![0]!.distanceM).toBe(6880);
  });

  it("同一人物の複数日を1人にまとめる", () => {
    const people = normalize({
      ...base,
      raws: [jpn(), jpn({ r: 125, st: "2026-07-21T10:13:00" })],
    });
    expect(people).toHaveLength(1);
    expect(people[0]!.entries["1"]![0]!.startTime).toBe("10:22");
    expect(people[0]!.entries["2"]![0]!.startTime).toBe("12:13");
  });

  it("同じ日の複数クラスを両方保持する", () => {
    const people = normalize({
      ...base,
      raws: [jpn(), jpn({ c: { i: 9999 }, st: "2026-07-20T09:00:00" })],
    });
    expect(people[0]!.entries["1"]).toHaveLength(2);
  });

  it("重複レコードで二重登録しない（冪等）", () => {
    const people = normalize({ ...base, raws: [jpn(), jpn()] });
    expect(people[0]!.entries["1"]).toHaveLength(1);
  });

  it("未知の raceId / classId は捨てる（throw しない）", () => {
    expect(normalize({ ...base, raws: [jpn({ r: 999 })] })).toHaveLength(0);
    expect(normalize({ ...base, raws: [jpn({ c: { i: 1 } })] })).toHaveLength(0);
  });

  it("壊れたレコードで throw しない", () => {
    expect(() => normalize({ ...base, raws: [{}, { p: {} }, { o: { c: "JPN" } }] })).not.toThrow();
  });
});

describe("集計", () => {
  it("countConfirmedStarts / countEntries", () => {
    const people = normalize({
      races,
      classNames,
      distances,
      nameMap,
      raws: [jpn(), jpn({ r: 125, st: undefined })],
    });
    expect(countEntries(people)).toBe(2);
    expect(countConfirmedStarts(people)).toBe(1);
  });
});
