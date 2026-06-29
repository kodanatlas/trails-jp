import { describe, it, expect } from "vitest";
import { isIndexRegression, assessRegression } from "../index-quality";
import type { AthleteEntryRef, EntryIndex } from "../index-types";

/** athletes を n 人持つだけのダミー index（scrapedEventIds 無し＝総数フォールバック経路を踏む）。 */
function idx(n: number): EntryIndex {
  const athletes: Record<string, never[]> = {};
  for (let i = 0; i < n; i++) athletes["k" + i] = [];
  return {
    generatedAt: "2026-06-17T00:00:00.000Z",
    targetEventCount: 0,
    scrapedEventCount: 0,
    athletes: athletes as EntryIndex["athletes"],
  };
}

function ref(eventId: number): AthleteEntryRef {
  return {
    joe_event_id: eventId,
    eventName: "E" + eventId,
    date: "2026-07-01",
    prefecture: "",
    className: "M21",
    affiliation: "",
    entryStatus: "open",
    joeUrl: "",
    totalEntries: 0,
  };
}

/**
 * 「大会ID → エントリー人数」分布から index を作る（per-event 判定用）。
 * 各エントリーを別 athlete キーに割り当てる（母数=エントリー数を素直に再現）。
 * zeroScraped: フェッチ成功したがエントリー0件の大会（ロゲイニング/講習等）の ID。
 */
function idxByEvent(
  perEvent: Record<number, number>,
  zeroScraped: number[] = [],
): EntryIndex {
  const athletes: Record<string, AthleteEntryRef[]> = {};
  let k = 0;
  for (const [evStr, n] of Object.entries(perEvent)) {
    const ev = Number(evStr);
    for (let i = 0; i < n; i++) athletes["a" + k++] = [ref(ev)];
  }
  const scrapedEventIds = [...Object.keys(perEvent).map(Number), ...zeroScraped];
  return {
    generatedAt: "2026-06-28T00:00:00.000Z",
    targetEventCount: scrapedEventIds.length,
    scrapedEventCount: scrapedEventIds.length,
    scrapedEventIds,
    athletes,
  };
}

/** 共通大会を minCommonEvents 以上にするための、小さな大会群（ID 1..count, 各 perEach 人）。 */
function commonEvents(count: number, perEach: number): Record<number, number> {
  const o: Record<number, number> = {};
  for (let i = 1; i <= count; i++) o[i] = perEach;
  return o;
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/** target/scraped を明示できる index ビルダ（カバレッジ判定・移行ケース用）。scrapedEventIds は省略可（旧 index）。 */
function idxWith(o: {
  perEvent?: Record<number, number>;
  scrapedEventIds?: number[];
  targetEventCount: number;
  scrapedEventCount: number;
}): EntryIndex {
  const athletes: Record<string, AthleteEntryRef[]> = {};
  let k = 0;
  for (const [evStr, n] of Object.entries(o.perEvent ?? {})) {
    const ev = Number(evStr);
    for (let i = 0; i < n; i++) athletes["a" + k++] = [ref(ev)];
  }
  return {
    generatedAt: "2026-06-28T00:00:00.000Z",
    targetEventCount: o.targetEventCount,
    scrapedEventCount: o.scrapedEventCount,
    scrapedEventIds: o.scrapedEventIds,
    athletes,
  };
}

const opts = { minRatio: 0.6, floor: 100 };

describe("isIndexRegression（総数フォールバック経路）", () => {
  it("prev が null なら劣化ではない（初回生成は常に書く）", () => {
    expect(isIndexRegression(null, idx(500), opts)).toBe(false);
  });

  it("既存が floor 未満なら判定しない（閑散期・成長期）", () => {
    expect(isIndexRegression(idx(50), idx(5), opts)).toBe(false);
  });

  it("athletes が大幅減（<60%）なら劣化", () => {
    expect(isIndexRegression(idx(1000), idx(500), opts)).toBe(true);
  });

  it("境界: ちょうど60%は劣化ではない（< 判定）", () => {
    expect(isIndexRegression(idx(1000), idx(600), opts)).toBe(false);
  });

  it("通常の微減（>60%）は劣化ではない", () => {
    expect(isIndexRegression(idx(1000), idx(800), opts)).toBe(false);
  });

  it("増加は劣化ではない", () => {
    expect(isIndexRegression(idx(1000), idx(1200), opts)).toBe(false);
  });

  it("ちょうど floor の既存で大幅減なら劣化", () => {
    expect(isIndexRegression(idx(100), idx(40), opts)).toBe(true);
  });
});

describe("assessRegression（per-event 経路）", () => {
  it("大会が窓外へ出た正常減少は劣化ではない（本件の再現: 大型大会の週末が過ぎた翌日）", () => {
    // prev: 共通10大会(各100=1000) + 過ぎた大型大会 100:633, 101:289（計922）。
    // next: 共通10大会(各100=1000) のみ。100/101 は窓外で scrape 対象に無い。
    const prev = idxByEvent({ ...commonEvents(10, 100), 100: 633, 101: 289 });
    const next = idxByEvent(commonEvents(10, 100));
    const a = assessRegression(prev, next, opts);
    expect(a.mode).toBe("per-event");
    expect(a.commonEvents).toBe(10);
    expect(a.prevBasis).toBe(1000); // 共通大会のみが母数（922 は除外）
    expect(a.nextBasis).toBe(1000);
    expect(a.regression).toBe(false); // 総数は 1922→1000 に半減でも、同一大会は不変 → 書く
  });

  it("同一大会の取りこぼし（ソフトブロックで 0 件化）は劣化", () => {
    // 共通10大会のうち 1..6 が next で 0 件化（フェッチは成功＝scraped に残る）、7..10 は健全。
    const prev = idxByEvent(commonEvents(10, 100)); // 1000
    const next = idxByEvent(
      { 7: 100, 8: 100, 9: 100, 10: 100 }, // 400
      [1, 2, 3, 4, 5, 6], // 0 件だがフェッチ成功（scraped 集合に残す）
    );
    const a = assessRegression(prev, next, opts);
    expect(a.mode).toBe("per-event");
    expect(a.prevBasis).toBe(1000);
    expect(a.nextBasis).toBe(400);
    expect(a.regression).toBe(true); // 400 < 1000*0.6 → 劣化
  });

  it("ロゲイニング/講習等（常に 0 件）は比に中立で誤検知しない", () => {
    // 999 は両 run で「フェッチ成功・0件」。共通集合に入るが prev/next とも 0 → 比に効かない。
    const prev = idxByEvent(commonEvents(10, 100), [999]);
    const next = idxByEvent(commonEvents(10, 100), [999]);
    const a = assessRegression(prev, next, opts);
    expect(a.mode).toBe("per-event");
    expect(a.regression).toBe(false);
  });

  it("境界: 同一大会の合計がちょうど 60% は劣化ではない（< 判定）", () => {
    const prev = idxByEvent(commonEvents(10, 100)); // 1000
    const next = idxByEvent({ 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100 }, [7, 8, 9, 10]); // 600
    expect(assessRegression(prev, next, opts).regression).toBe(false);
  });

  it("共通大会が minCommonEvents 未満なら総数フォールバックに切替", () => {
    // prev/next で scrape 大会が全く重ならない → 共通 0 → fallback-count。
    const prev = idxByEvent({ 1: 1000 });
    const next = idxByEvent({ 2: 500 });
    const a = assessRegression(prev, next, opts);
    expect(a.mode).toBe("fallback-count");
    expect(a.regression).toBe(true); // 500 < 1000*0.6
  });

  it("旧 index（scrapedEventIds 無し）が prev なら総数フォールバック", () => {
    const prev = idx(1000); // scrapedEventIds 無し
    const next = idxByEvent(commonEvents(10, 100)); // 1000 athletes だが prev 側に ID 無し
    const a = assessRegression(prev, next, opts);
    expect(a.mode).toBe("fallback-count");
    expect(a.regression).toBe(false); // 1000 vs 1000
  });

  it("per-event の母数が floor 未満なら判定しない（薄いデータ）", () => {
    // 共通8大会だが各1人=8 < floor(100) → skip-floor。
    const prev = idxByEvent(commonEvents(8, 1));
    const next = idxByEvent({ 1: 0 } as Record<number, number>, [2, 3, 4, 5, 6, 7, 8]);
    const a = assessRegression(prev, next, opts);
    expect(a.mode).toBe("skip-floor");
    expect(a.regression).toBe(false);
  });
});

describe("assessRegression（カバレッジ崩壊・移行）", () => {
  it("対象90中9件しか取れない部分スクレイプは、取れた9件が健全でも劣化（per-event を上書き）", () => {
    // prev: 90大会を健全取得(各10人)。next: 同じ9大会だけ取得(各10人)、残り81はfetch失敗で未計上。
    const prev = idxWith({
      perEvent: commonEvents(90, 10),
      scrapedEventIds: range(1, 90),
      targetEventCount: 90,
      scrapedEventCount: 90,
    });
    const next = idxWith({
      perEvent: commonEvents(9, 10),
      scrapedEventIds: range(1, 9),
      targetEventCount: 90, // 90 を狙ったが
      scrapedEventCount: 9, // 9 しか取れていない（9/90=0.1 < 0.7）
    });
    const a = assessRegression(prev, next, opts);
    expect(a.mode).toBe("coverage-collapse");
    expect(a.regression).toBe(true);
  });

  it("通常カバレッジ(77/78)は coverage-collapse にならない", () => {
    const prev = idxWith({
      perEvent: commonEvents(40, 20),
      scrapedEventIds: range(1, 78),
      targetEventCount: 78,
      scrapedEventCount: 77,
    });
    const next = idxWith({
      perEvent: commonEvents(40, 20),
      scrapedEventIds: range(1, 78),
      targetEventCount: 78,
      scrapedEventCount: 77,
    });
    const a = assessRegression(prev, next, opts);
    expect(a.mode).toBe("per-event");
    expect(a.regression).toBe(false);
  });

  it("移行直後(prev に scrapedEventIds 無し)＋カバレッジ健全＋総数安定なら書く（誤ブロックしない）", () => {
    const prev = idx(863); // 旧 index: scrapedEventIds 無し
    const next = idxWith({
      perEvent: commonEvents(40, 20), // 800 athletes
      scrapedEventIds: range(1, 78),
      targetEventCount: 78,
      scrapedEventCount: 77,
    });
    const a = assessRegression(prev, next, opts);
    expect(a.mode).toBe("fallback-count"); // prev に ID 無く per-event 不可
    expect(a.regression).toBe(false); // 800/863=0.93 → 書く
  });

  it("移行直後でも総数が壊滅的に減れば総数フォールバックで弾く", () => {
    const prev = idx(1000); // 旧 index
    const next = idxWith({
      perEvent: commonEvents(15, 20), // 300 athletes
      scrapedEventIds: range(1, 78),
      targetEventCount: 78,
      scrapedEventCount: 77, // カバレッジは健全（coverage-collapse ではない）
    });
    const a = assessRegression(prev, next, opts);
    expect(a.mode).toBe("fallback-count");
    expect(a.regression).toBe(true); // 300 < 1000*0.6 → 弾く
  });

  it("閑散期(target が minTargetsForCoverage 未満)はカバレッジ判定をスキップ", () => {
    const prev = idxWith({
      perEvent: commonEvents(5, 30),
      scrapedEventIds: range(1, 5),
      targetEventCount: 5,
      scrapedEventCount: 5,
    });
    const next = idxWith({
      perEvent: { 1: 30, 2: 30 },
      scrapedEventIds: [1, 2],
      targetEventCount: 5, // 5 < 10 → coverage 判定しない
      scrapedEventCount: 2,
    });
    const a = assessRegression(prev, next, opts);
    expect(a.mode).not.toBe("coverage-collapse");
  });
});
