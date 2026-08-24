import { describe, expect, it } from "vitest";
import {
  EXCLUDED_NAME_KEYWORDS,
  LIKELY_AFFINITY_THRESHOLD,
  findMatchGaps,
  nameAffinity,
} from "../match-gaps";
import type { LapCenterEvent } from "../../scraper/lapcenter";
import { extractMatchGapSummary } from "../../cron-status";

const NOW = new Date("2026-08-24T03:00:00.000Z");
const WINDOW_DAYS = 60;

interface TestJoeEvent {
  joe_event_id: number;
  name: string;
  date: string;
  joe_url: string;
  lapcenter_event_id?: number;
  tags?: string[];
  source?: string;
}

function joeEvent(
  joe_event_id: number,
  date: string,
  overrides: Partial<TestJoeEvent> = {},
): TestJoeEvent {
  return {
    joe_event_id,
    name: `JOY大会${joe_event_id}`,
    date,
    joe_url: `https://japan-o-entry.com/event/view/${joe_event_id}`,
    tags: [],
    ...overrides,
  };
}

function lcEvent(eventId: number, date: string, name = `LC大会${eventId}`): LapCenterEvent {
  return { eventId, date, name };
}

function serializedGap(
  joe_event_id: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    joe_event_id,
    joe_name: `JOY大会${joe_event_id}`,
    date: "2026-08-24",
    joe_url: `https://japan-o-entry.com/event/view/${joe_event_id}`,
    lc: [{ eventId: 100 + joe_event_id, name: `LC大会${joe_event_id}` }],
    affinity: 0.5,
    tier: "likely",
    ...overrides,
  };
}

describe("nameAffinity", () => {
  const fixtures: Array<{
    label: string;
    joe: string;
    lc: string;
    expected: number | null;
    tier: "likely" | "possible";
  }> = [
    // 下記3件の値は 2026-08-24 の EVENT_ALIASES 追加（中高選手権 → 全国中学校高等学校…、
    // 彩の森入間公園 → 入間市）で上がった。nameAffinity は fuzzyMatch と同じ normalize を
    // 通すため、alias を足すと類似度も連動して上がる。**閾値 0.15 の根拠は alias 追加前の
    // 値（0.333 / 0.214 / 0.167）であり、この新しい値を根拠に閾値を上げてはいけない**。
    // alias が無い未知の漏れは今も旧レンジで出るため、上げると拾えなくなる。
    {
      label: "中高選手権の個人競技は likely 側になる",
      joe: "中高選手権　個人オープン競技",
      lc: "第40回全国中学校高等学校オリエンテーリング選手権大会個人競技",
      expected: 0.84, // alias 追加前は 0.333
      tier: "likely",
    },
    {
      label: "彩の森入間公園の体験会は likely 側になる",
      joe: "彩の森入間公園OL体験会＆併設ロゲ",
      lc: "第56回(26年度8月度)入間市オリエンテーリング体験会",
      expected: 0.364, // alias 追加前は 0.214
      tier: "likely",
    },
    {
      label: "中高選手権の団体競技は likely 側になる",
      joe: "中高選手権　団体オープン競技",
      lc: "第40回全国中学校高等学校オリエンテーリング選手権大会",
      expected: 0.905, // alias 追加前は 0.167
      tier: "likely",
    },
    {
      label: "オンライン研修と夏合宿は閾値未満になる",
      joe: "コーチ資格更新研修会（オンライン）",
      lc: "入間市OLC夏合宿Day1",
      expected: 0,
      tier: "possible",
    },
    {
      label: "集合研修とWMOCは閾値未満になる",
      joe: "コーチ資格更新研修会（集合2日目）",
      lc: "WMOC 2026 Sprint Final",
      expected: 0,
      tier: "possible",
    },
    {
      label: "千葉大練習会とスプセレ対策練は閾値未満になる",
      joe: "千葉大OLC 技術局練習会",
      lc: "スプセレ対策練",
      expected: 0,
      tier: "possible",
    },
    {
      label: "ネイチャリングフェスタと夏合宿は閾値未満になる",
      joe: "ネイチャリングフェスタ2026",
      lc: "入間市OLC夏合宿 Day2",
      expected: 0,
      tier: "possible",
    },
    {
      // 既知の誤検出。normalize が「千葉大」→「千葉大学」を展開する結果 0.167 になる。
      // alias 追加前は真の「中高選手権 団体」も 0.167 で同値＝分離不能だった。alias 追加後は
      // 真が 0.905 まで上がって見かけ上は離れたが、alias が無い未知の漏れは今も旧レンジで
      // 出るため、閾値を上げてこの誤検出を切る判断はしない（match-gaps.ts の閾値コメント参照）。
      // 値ごと固定して、normalize や係数の変更でこの均衡が動いたら気づけるようにする。
      label: "千葉大練習会と夏合宿は誤検出だが閾値を超える（MANUAL_LC_NO_MATCH でミュート）",
      joe: "千葉大OLC 技術局練習会",
      lc: "入間市OLC夏合宿 Day2",
      expected: 0.167,
      tier: "likely",
    },
  ];

  it.each(fixtures)("$label", ({ joe, lc, expected, tier }) => {
    const affinity = nameAffinity(joe, lc);
    if (expected !== null) expect(affinity).toBe(expected);
    expect(affinity >= LIKELY_AFFINITY_THRESHOLD ? "likely" : "possible").toBe(tier);
  });

  it("どちらかの正規化結果からバイグラムを作れなければ0を返す", () => {
    expect(nameAffinity("A", "AB")).toBe(0);
    expect(nameAffinity("", "大会")).toBe(0);
  });

  it("likely判定の閾値を0.15に固定する", () => {
    expect(LIKELY_AFFINITY_THRESHOLD).toBe(0.15);
  });
});

describe("findMatchGaps", () => {
  const opts = { now: NOW, windowDays: WINDOW_DAYS };

  it("JSTのウィンドウより古い大会と未来の大会を除外する", () => {
    const joe = [
      joeEvent(1, "2026-06-24"),
      joeEvent(2, "2026-08-25"),
      joeEvent(3, "2026-06-25"),
      joeEvent(4, "2026-08-24"),
    ];
    const lc = joe.map((event) => lcEvent(100 + event.joe_event_id, event.date));

    expect(findMatchGaps(joe, lc, opts).map((gap) => gap.joe_event_id)).toEqual([4, 3]);
  });

  it("UTCとJSTで暦日が異なる時刻でもJST側の日付でウィンドウを決める", () => {
    const now = new Date("2026-08-24T16:00:00.000Z");
    const joe = [
      joeEvent(1, "2026-06-25"),
      joeEvent(2, "2026-06-26"),
      joeEvent(3, "2026-08-25"),
      joeEvent(4, "2026-08-26"),
    ];
    const lc = joe.map((event) => lcEvent(100 + event.joe_event_id, event.date));

    expect(
      findMatchGaps(joe, lc, { now, windowDays: WINDOW_DAYS }).map(
        (gap) => gap.joe_event_id,
      ),
    ).toEqual([3, 2]);
  });

  it("lapcenter_event_idが付いているJOY大会を除外する", () => {
    const joe = [joeEvent(1, "2026-08-01", { lapcenter_event_id: 100 })];
    const lc = [lcEvent(101, "2026-08-01")];

    expect(findMatchGaps(joe, lc, opts)).toEqual([]);
  });

  it("MANUAL_LC_NO_MATCH掲載分を除外する", () => {
    const joe = [joeEvent(2567, "2026-08-01", { name: "ネイチャリングフェスタ2026" })];
    const lc = [lcEvent(101, "2026-08-01")];

    expect(findMatchGaps(joe, lc, opts)).toEqual([]);
  });

  it.each(["講習", "ロゲ", "SKI", "どこオリ"])("tagsの%sを除外する", (tag) => {
    const joe = [joeEvent(1, "2026-08-01", { tags: [tag] })];
    const lc = [lcEvent(101, "2026-08-01")];

    expect(findMatchGaps(joe, lc, opts)).toEqual([]);
  });

  it.each([...EXCLUDED_NAME_KEYWORDS])("大会名に%sを含むイベントを除外する", (keyword) => {
    const joe = [joeEvent(1, "2026-08-01", { name: `夏季${keyword}イベント` })];
    const lc = [lcEvent(101, "2026-08-01")];

    expect(findMatchGaps(joe, lc, opts)).toEqual([]);
  });

  it('sourceが"dokori"のイベントを除外する', () => {
    const joe = [joeEvent(1, "2026-08-01", { source: "dokori" })];
    const lc = [lcEvent(101, "2026-08-01")];

    expect(findMatchGaps(joe, lc, opts)).toEqual([]);
  });

  it("同日に未使用のLapCenter大会が無ければ候補にしない", () => {
    const joe = [joeEvent(1, "2026-08-01")];
    const lc = [lcEvent(101, "2026-08-02")];

    expect(findMatchGaps(joe, lc, opts)).toEqual([]);
  });

  it("同日に未使用のLapCenter大会が複数あれば最大のaffinityを採用する", () => {
    const joe = [joeEvent(1, "2026-08-01", { name: "abcdef" })];
    const lc = [
      lcEvent(101, "2026-08-01", "abcxyz"),
      lcEvent(102, "2026-08-01", "abcdef"),
    ];

    const gaps = findMatchGaps(joe, lc, opts);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].affinity).toBe(1);
  });

  it("ウィンドウ外を含む他のJOY大会に割り当て済みのLCを候補に含めない", () => {
    const joe = [
      joeEvent(1, "2020-01-01", { lapcenter_event_id: 101 }),
      joeEvent(2, "2026-08-01"),
    ];
    const lc = [
      lcEvent(101, "2026-08-01", "割り当て済みLC"),
      lcEvent(102, "2026-08-01", "未使用LC"),
    ];

    const gaps = findMatchGaps(joe, lc, opts);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].lc).toEqual([{ eventId: 102, name: "未使用LC" }]);
  });

  it("likelyをpossibleより前にし、各tier内は日付の新しい順に並べる", () => {
    const joe = [
      joeEvent(1, "2026-08-20", { name: "中高選手権　個人オープン競技" }),
      joeEvent(2, "2026-08-10", { name: "中高選手権　団体オープン競技" }),
      joeEvent(3, "2026-08-23", { name: "abc" }),
      joeEvent(4, "2026-08-05", { name: "def" }),
    ];
    const lc = [
      lcEvent(101, "2026-08-20", "第40回全国中学校高等学校オリエンテーリング選手権大会個人競技"),
      lcEvent(102, "2026-08-10", "第40回全国中学校高等学校オリエンテーリング選手権大会"),
      lcEvent(103, "2026-08-23", "xyz"),
      lcEvent(104, "2026-08-05", "uvw"),
    ];

    const gaps = findMatchGaps(joe, lc, opts);
    expect(gaps.map(({ joe_event_id, tier }) => ({ joe_event_id, tier }))).toEqual([
      { joe_event_id: 1, tier: "likely" },
      { joe_event_id: 2, tier: "likely" },
      { joe_event_id: 3, tier: "possible" },
      { joe_event_id: 4, tier: "possible" },
    ]);
  });
});

describe("extractMatchGapSummary", () => {
  it.each([
    ["null", null, 0],
    ["文字列", "invalid", 0],
    ["match_gapsが配列でない", { match_gaps_status: "ok", match_gaps: {} }, 0],
    ["候補要素が不正", { match_gaps_status: "ok", match_gaps: [null] }, 1],
  ])("%sでも例外にせず候補を空で返す", (_label, result, rejected) => {
    expect(() => extractMatchGapSummary(result)).not.toThrow();
    expect(extractMatchGapSummary(result)).toMatchObject({
      candidates: [],
      total: 0,
      rejected,
    });
  });

  it("未信頼候補を厳格に検証し、不正件数を返す", () => {
    const longName = "長".repeat(201);
    const tooManyLc = Array.from({ length: 51 }, (_, index) => ({
      eventId: index + 1,
      name: `LC大会${index + 1}`,
    }));
    const invalidCandidates = [
      serializedGap(1, { joe_event_id: 0 }),
      serializedGap(2, { date: "2026/08/24" }),
      serializedGap(3, { affinity: 1.01 }),
      serializedGap(4, { joe_url: "javascript:alert(1)" }),
      serializedGap(5, { lc: [] }),
      serializedGap(6, { joe_name: longName }),
      serializedGap(7, { lc: [{ eventId: 1.5, name: "LC大会" }] }),
      serializedGap(8, { lc: [{ eventId: 108, name: longName }] }),
      serializedGap(9, { lc: tooManyLc }),
    ];

    const summary = extractMatchGapSummary({
      match_gaps_status: "ok",
      match_gaps: [serializedGap(10), ...invalidCandidates],
    });

    expect(summary.candidates).toHaveLength(1);
    expect(summary.candidates[0].joe_event_id).toBe(10);
    expect(summary.rejected).toBe(invalidCandidates.length);
  });

  it("表示候補を最大20件に切り詰める", () => {
    const summary = extractMatchGapSummary({
      match_gaps_status: "ok",
      match_gaps: Array.from({ length: 21 }, (_, index) => serializedGap(index + 1)),
    });

    expect(summary.candidates).toHaveLength(20);
    expect(summary.total).toBe(21);
    expect(summary.truncated).toBe(true);
    expect(summary.rejected).toBe(0);
  });

  it("match_gaps_statusがない旧形式はunknownとして扱う", () => {
    const summary = extractMatchGapSummary({ match_gaps: [serializedGap(1)] });

    expect(summary.status).toBe("unknown");
    expect(summary.error).toBeNull();
  });

  it("検知不能の理由を200文字に切り詰めて取り出す", () => {
    const summary = extractMatchGapSummary({
      match_gaps_status: "unavailable",
      match_gaps_error: "失".repeat(201),
      match_gaps: [],
    });

    expect(summary.status).toBe("unavailable");
    expect(summary.error).toBe("失".repeat(200));
  });
});
