import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JOEEvent } from "@/lib/scraper/events";
import type { EntryListResult } from "@/lib/scraper/entries";
import type { AthleteEntryRef, EntryIndex } from "../index-types";

// 大会ID → スクレイプ結果（null は取得失敗）
const scrapeResults = new Map<number, EntryListResult | null>();

vi.mock("@/lib/scraper/entry-source", () => ({
  scrapeEntryListByEventId: vi.fn(async (eventId: number) => {
    const r = scrapeResults.get(eventId);
    if (!r) throw new Error("fetch failed");
    return r;
  }),
}));

const { buildEntryIndex } = await import("../build-index");

function ev(id: number, date = "2026-11-29"): JOEEvent {
  return {
    joe_event_id: id,
    name: `大会${id}`,
    date,
    prefecture: "東京都",
    entry_status: "closed",
    tags: [],
    joe_url: `https://japan-o-entry.com/event/view/${id}`,
  };
}

function listOf(id: number, people: [string, string][]): EntryListResult {
  return {
    eventId: id,
    total: people.length,
    teams: [
      {
        affiliation: "クラブ",
        count: people.length,
        entries: people.map(([name, className]) => ({ name, className, affiliation: "クラブ" })),
      },
    ],
    fetchedAt: "2026-11-04T00:00:00.000Z",
  };
}

/** 非公開化後のページ: 表が無く、公称人数だけがある */
function hidden(id: number, announced: number): EntryListResult {
  return { eventId: id, total: announced, teams: [], fetchedAt: "2026-11-04T00:00:00.000Z" };
}

function prevRef(id: number, className: string, name = `大会${id}`): AthleteEntryRef {
  return {
    joe_event_id: id,
    eventName: name,
    date: "2026-11-29",
    prefecture: "東京都",
    className,
    affiliation: "クラブ",
    entryStatus: "open",
    joeUrl: `https://japan-o-entry.com/event/view/${id}`,
    totalEntries: 2,
  };
}

function prevIndex(athletes: EntryIndex["athletes"]): EntryIndex {
  return {
    generatedAt: "2026-11-03T00:00:00.000Z",
    targetEventCount: 2,
    scrapedEventCount: 2,
    scrapedEventIds: [2415, 3000],
    athletes,
  };
}

describe("buildEntryIndex: エントリーリスト非公開化の持ち越し", () => {
  beforeEach(() => scrapeResults.clear());

  it("今回0件・前回あり の大会は前回のエントリーを carriedOver 付きで引き継ぐ", async () => {
    scrapeResults.set(2415, hidden(2415, 650));
    scrapeResults.set(3000, listOf(3000, [["山田太郎", "M21A"]]));
    const prev = prevIndex({
      児玉健: [prevRef(2415, "MA")],
      辻悠佳: [prevRef(2415, "WE"), prevRef(3000, "W21A")],
    });

    const idx = await buildEntryIndex([ev(2415), ev(3000)], { seeds: {} }, prev);

    expect(idx.athletes["児玉健"]).toEqual([
      expect.objectContaining({ joe_event_id: 2415, className: "MA", carriedOver: true }),
    ]);
    // 辻さんの 3000 は今回のスクレイプで消えた（=正しい減少）ので持ち越さない。2415 だけ残る
    expect(idx.athletes["辻悠佳"]).toEqual([
      expect.objectContaining({ joe_event_id: 2415, className: "WE", carriedOver: true }),
    ]);
    expect(idx.athletes["山田太郎"]?.[0]?.carriedOver).toBeUndefined();
    expect(idx.carriedEventIds).toEqual([2415]);
  });

  it("持ち越したエントリーの大会名・日付・受付状態は今回の大会情報で更新し、公称人数を使う", async () => {
    scrapeResults.set(2415, hidden(2415, 650));
    const prev = prevIndex({ 児玉健: [prevRef(2415, "MA", "旧名")] });
    const current = { ...ev(2415, "2026-11-30"), name: "伊豆大島大会2026" };

    const idx = await buildEntryIndex([current], { seeds: {} }, prev);

    expect(idx.athletes["児玉健"][0]).toMatchObject({
      eventName: "伊豆大島大会2026",
      date: "2026-11-30",
      entryStatus: "closed",
      totalEntries: 650,
      carriedOver: true,
    });
  });

  it("今回エントリーがある大会は前回分を持ち越さない（通常どおり上書き）", async () => {
    scrapeResults.set(2415, listOf(2415, [["児玉健", "MA"]]));
    const prev = prevIndex({ 辻悠佳: [prevRef(2415, "WE")] });

    const idx = await buildEntryIndex([ev(2415)], { seeds: {} }, prev);

    expect(idx.athletes["辻悠佳"]).toBeUndefined();
    expect(idx.athletes["児玉健"][0].carriedOver).toBeUndefined();
    expect(idx.carriedEventIds).toEqual([]);
  });

  it("前回の索引が無い・前回もその大会が0件なら何も足さない", async () => {
    scrapeResults.set(2415, hidden(2415, 0));
    expect((await buildEntryIndex([ev(2415)], { seeds: {} }, null)).athletes).toEqual({});
    expect(
      (await buildEntryIndex([ev(2415)], { seeds: {} }, prevIndex({ 児玉健: [prevRef(3000, "MA")] }))).athletes,
    ).toEqual({});
  });

  it("対象外の大会（今回の targets に無い＝期間外・中止）は持ち越さない", async () => {
    scrapeResults.set(3000, listOf(3000, [["山田太郎", "M21A"]]));
    const prev = prevIndex({ 児玉健: [prevRef(2415, "MA")] });

    const idx = await buildEntryIndex([ev(3000)], { seeds: {} }, prev);

    expect(idx.athletes["児玉健"]).toBeUndefined();
  });

  it("取得に失敗した大会は従来どおり持ち越し対象にしない", async () => {
    scrapeResults.set(2415, null);
    const prev = prevIndex({ 児玉健: [prevRef(2415, "MA")] });

    const idx = await buildEntryIndex([ev(2415)], { overallBudgetMs: 2000, seeds: {} }, prev);

    expect(idx.athletes["児玉健"]).toBeUndefined();
    expect(idx.carriedEventIds).toEqual([]);
  });

  it("持ち越しは次の回でも続く（前回の持ち越し分を再び持ち越す）", async () => {
    scrapeResults.set(2415, hidden(2415, 650));
    const prev = prevIndex({ 児玉健: [{ ...prevRef(2415, "MA"), carriedOver: true }] });

    const idx = await buildEntryIndex([ev(2415)], { seeds: {} }, prev);

    expect(idx.athletes["児玉健"]).toHaveLength(1);
    expect(idx.athletes["児玉健"][0].carriedOver).toBe(true);
  });

  it("前回索引にも無い大会は、seed（主催者リスト）で補う。別名キーにも展開する", async () => {
    scrapeResults.set(2415, hidden(2415, 650));
    const seeds = {
      "2415": { rows: [
        { name: "児玉 健", className: "MA", affiliation: "入間市OLC/JDOA" },
        { name: "児玉 健", className: "MA", affiliation: "入間市OLC/JDOA" },
      ] },
    };

    const idx = await buildEntryIndex([ev(2415)], { seeds }, null);

    expect(idx.athletes["児玉健"]).toEqual([
      expect.objectContaining({ joe_event_id: 2415, className: "MA", carriedOver: true, totalEntries: 650 }),
    ]);
    expect(idx.carriedEventIds).toEqual([2415]);
  });

  it("前回索引に分があれば seed より前回を優先し、今回エントリーが取れた大会には seed を使わない", async () => {
    scrapeResults.set(2415, hidden(2415, 650));
    scrapeResults.set(3000, listOf(3000, [["山田太郎", "M21A"]]));
    const seeds = {
      "2415": { rows: [{ name: "別人 花子", className: "WA", affiliation: "X" }] },
      "3000": { rows: [{ name: "別人 次郎", className: "MA", affiliation: "X" }] },
    };
    const prev = prevIndex({ 児玉健: [prevRef(2415, "MA")] });

    const idx = await buildEntryIndex([ev(2415), ev(3000)], { seeds }, prev);

    expect(idx.athletes["児玉健"]).toHaveLength(1);
    expect(idx.athletes["別人花子"]).toBeUndefined();
    expect(idx.athletes["別人次郎"]).toBeUndefined();
  });

  it("実データ: 同梱の seed に伊豆大島大会2026（2415）の会員エントリーが入っている", async () => {
    scrapeResults.set(2415, hidden(2415, 650));
    const idx = await buildEntryIndex([ev(2415)], {}, null);
    for (const k of ["児玉健", "辻悠佳", "堤大揮", "上園久美子", "三宅裕子", "小嶋太郎"]) {
      expect(idx.athletes[k]?.[0]).toMatchObject({ joe_event_id: 2415, carriedOver: true });
    }
  });
});
