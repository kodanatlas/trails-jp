import { describe, it, expect } from "vitest";
import {
  computeWeekendPoints,
  type WPInputAthlete,
} from "./weekend-points";

const TODAY = "2026-06-15"; // 月曜 → 直近土日祝クラスタは 6/13(土),6/14(日)

/** baseline 用の過去イベント（clusterMin より前）を n 件、指定 points 平均になるよう生成 */
function pastEvents(
  points: number,
  n: number,
  discipline: "forest" | "sprint",
): WPInputAthlete["events"] {
  // 2026-03〜05 の任意日（土日祝でなくてよい＝baseline は date < clusterMin で拾う）
  const out: WPInputAthlete["events"] = [];
  for (let i = 0; i < n; i++) {
    const day = String(10 + i).padStart(2, "0");
    out.push({ date: `2026-04-${day}`, points, discipline });
  }
  return out;
}

describe("computeWeekendPoints", () => {
  it("対象週末の delta を計算し、targetDates を選択する", () => {
    const athletes: WPInputAthlete[] = [
      {
        key: "山田太郎",
        club: "東京OLC",
        events: [
          ...pastEvents(1000, 4, "forest"), // 平均 1000
          { date: "2026-06-13", points: 1200, discipline: "forest" }, // 今回 +200
        ],
      },
    ];
    const r = computeWeekendPoints(athletes, TODAY);
    expect(r.targetDates).toEqual(["2026-06-13"]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      key: "山田太郎",
      discipline: "forest",
      pRecent: 1200,
      pAvg: 1000,
      delta: 200,
    });
  });

  it("minSamples 未満の baseline は除外する（既定 3）", () => {
    const athletes: WPInputAthlete[] = [
      {
        key: "佐藤次郎",
        club: "A",
        events: [
          ...pastEvents(1000, 2, "forest"), // 2件 < 3 → 除外
          { date: "2026-06-13", points: 1500, discipline: "forest" },
        ],
      },
    ];
    const r = computeWeekendPoints(athletes, TODAY);
    expect(r.items).toHaveLength(0);
  });

  it("delta <= 0 は除外する", () => {
    const athletes: WPInputAthlete[] = [
      {
        key: "鈴木三郎",
        club: "A",
        events: [
          ...pastEvents(1000, 4, "forest"),
          { date: "2026-06-13", points: 900, discipline: "forest" }, // 自己平均割れ
        ],
      },
    ];
    const r = computeWeekendPoints(athletes, TODAY);
    expect(r.items).toHaveLength(0);
  });

  it("両種目該当時は delta 最大の種目 1 件のみ採用する", () => {
    const athletes: WPInputAthlete[] = [
      {
        key: "高橋四郎",
        club: "A",
        events: [
          ...pastEvents(1000, 4, "forest"),
          ...pastEvents(800, 4, "sprint"),
          { date: "2026-06-13", points: 1100, discipline: "forest" }, // +100
          { date: "2026-06-14", points: 1100, discipline: "sprint" }, // +300（最大）
        ],
      },
    ];
    const r = computeWeekendPoints(athletes, TODAY);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].discipline).toBe("sprint");
    expect(r.items[0].delta).toBe(300);
  });

  it("topN で件数を制限し、delta 降順に並べる", () => {
    const athletes: WPInputAthlete[] = [];
    // delta = 100,200,...,700 の 7 名
    for (let i = 1; i <= 7; i++) {
      athletes.push({
        key: `選手${i}`,
        club: "A",
        events: [
          ...pastEvents(1000, 4, "forest"),
          { date: "2026-06-13", points: 1000 + i * 100, discipline: "forest" },
        ],
      });
    }
    const r = computeWeekendPoints(athletes, TODAY, { topN: 3 });
    expect(r.items).toHaveLength(3);
    expect(r.items.map((x) => x.delta)).toEqual([700, 600, 500]); // 降順
  });

  it("対象日のデータが無ければ targetDates も items も空", () => {
    const athletes: WPInputAthlete[] = [
      {
        key: "古株五郎",
        club: "A",
        events: pastEvents(1000, 5, "forest"), // 全部 4月（土日祝候補に該当する週末なし）
      },
    ];
    const r = computeWeekendPoints(athletes, TODAY);
    expect(r.targetDates).toEqual([]);
    expect(r.items).toEqual([]);
  });

  it("pRecent は対象日の最大 points を採用する", () => {
    const athletes: WPInputAthlete[] = [
      {
        key: "複数出走六郎",
        club: "A",
        events: [
          ...pastEvents(1000, 4, "forest"),
          { date: "2026-06-13", points: 1100, discipline: "forest" },
          { date: "2026-06-14", points: 1300, discipline: "forest" }, // 最大
        ],
      },
    ];
    const r = computeWeekendPoints(athletes, TODAY);
    expect(r.items[0].pRecent).toBe(1300);
    expect(r.items[0].delta).toBe(300);
  });
});
