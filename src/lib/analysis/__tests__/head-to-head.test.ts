import { describe, it, expect } from "vitest";
import {
  isUmbrellaClass,
  hasMergedNamesakes,
  scoreCandidates,
  tallyH2H,
} from "../head-to-head";
import type {
  AthleteSummary,
  AthleteIndex,
  RankingRef,
  RankingAppearance,
  EventScore,
} from "../types";

// ---- フィクスチャ ----

function rr(
  type: string,
  className: string,
  rank: number,
  totalPoints: number,
  isActive = true,
): RankingRef {
  return { type, className, rank, totalPoints, isActive };
}

function sum(name: string, clubs: string[], appearances: RankingRef[]): AthleteSummary {
  return {
    name,
    clubs,
    appearances,
    bestRank: Math.min(...appearances.map((a) => a.rank)),
    avgTotalPoints: appearances[0]?.totalPoints ?? 0,
    forestCount: appearances.filter((a) => a.type.includes("forest")).length,
    sprintCount: appearances.filter((a) => a.type.includes("sprint")).length,
    type: "allrounder",
    recentForm: 0,
  };
}

function idx(athletes: AthleteSummary[]): AthleteIndex {
  return {
    athletes: Object.fromEntries(athletes.map((a) => [a.name, a])),
    generatedAt: "2026-07-08",
  };
}

function appr(
  type: string,
  className: string,
  rank: number,
  events: EventScore[],
): RankingAppearance {
  return { type, className, rank, totalPoints: 0, isActive: true, events };
}

describe("isUmbrellaClass / hasMergedNamesakes", () => {
  it("無差別・Open は包括カテゴリ", () => {
    expect(isUmbrellaClass("無差別")).toBe(true);
    expect(isUmbrellaClass("女子無差別")).toBe(true);
    expect(isUmbrellaClass("S_Open")).toBe(true);
    expect(isUmbrellaClass("M21")).toBe(false);
    expect(isUmbrellaClass("M21E")).toBe(false);
  });
  it("同一(type,className)が重複する選手を検出", () => {
    expect(hasMergedNamesakes(sum("A", ["c"], [rr("age_forest", "M21", 1, 100), rr("age_forest", "M21", 5, 90)]))).toBe(true);
    expect(hasMergedNamesakes(sum("B", ["c"], [rr("age_forest", "M21", 1, 100), rr("age_forest", "M35", 2, 90)]))).toBe(false);
  });
});

describe("scoreCandidates", () => {
  const me = sum("自分", ["自クラブ"], [
    rr("age_forest", "M21", 10, 5000),
    rr("age_forest", "無差別", 580, 5000),
  ]);

  it("専門クラスの近成績者が、包括カテゴリだけ順位が近い相手より上位に来る", () => {
    // A: M21 を共有（順位差2・得点差10）。B: 無差別のみ共有（順位差1・得点差1＝旧ロジックなら最上位）
    const A = sum("専門ライバル", ["他クラブ"], [rr("age_forest", "M21", 12, 4990)]);
    const B = sum("無差別ノイズ", ["他クラブ"], [rr("age_forest", "無差別", 581, 4999)]);
    const cands = scoreCandidates(me, idx([A, B]));
    expect(cands[0].athlete.name).toBe("専門ライバル");
    // B も候補には出る（ペナルティ付きで後方）
    expect(cands.map((c) => c.athlete.name)).toContain("無差別ノイズ");
    expect(cands.findIndex((c) => c.athlete.name === "専門ライバル")).toBeLessThan(
      cands.findIndex((c) => c.athlete.name === "無差別ノイズ"),
    );
  });

  it("同一専門クラス内は得点差が小さい方が上位", () => {
    const near = sum("僅差", ["他クラブ"], [rr("age_forest", "M21", 11, 4995)]); // 差5
    const far = sum("大差", ["他クラブ"], [rr("age_forest", "M21", 9, 4900)]); // 差100
    const cands = scoreCandidates(me, idx([far, near]));
    expect(cands[0].athlete.name).toBe("僅差");
  });

  it("同クラブ枠が先に埋まる", () => {
    const sameClub = Array.from({ length: 6 }, (_, i) =>
      sum(`同僚${i}`, ["自クラブ"], [rr("age_forest", "M21", 20 + i, 4000 - i * 50)]),
    );
    const otherClub = Array.from({ length: 6 }, (_, i) =>
      sum(`他人${i}`, ["別クラブ"], [rr("age_forest", "M21", 11 + i, 4990 - i)]),
    );
    const cands = scoreCandidates(me, idx([...otherClub, ...sameClub]), { max: 8, sameClubQuota: 4 });
    const sameClubPicked = cands.filter((c) => c.label.startsWith("同クラブ"));
    expect(sameClubPicked.length).toBeGreaterThanOrEqual(4);
    expect(cands.length).toBe(8);
  });

  it("同姓同名合成の選手は候補から除外", () => {
    const dup = sum("合成太郎", ["他クラブ"], [
      rr("age_forest", "M21", 11, 4990),
      rr("age_forest", "M21", 13, 4980), // 同一クラス重複＝合成疑い
    ]);
    const clean = sum("健全次郎", ["他クラブ"], [rr("age_forest", "M21", 12, 4985)]);
    const cands = scoreCandidates(me, idx([dup, clean]));
    expect(cands.map((c) => c.athlete.name)).not.toContain("合成太郎");
    expect(cands.map((c) => c.athlete.name)).toContain("健全次郎");
  });

  it("共通クラスが無い選手は候補外", () => {
    const noShare = sum("無関係", ["他クラブ"], [rr("age_sprint_S", "M21", 5, 6000)]);
    expect(scoreCandidates(me, idx([noShare]))).toHaveLength(0);
  });
});

describe("tallyH2H", () => {
  it("勝敗と平均得点差（自分−相手）を集計", () => {
    const mine: RankingAppearance[] = [
      appr("age_forest", "M21", 10, [
        { date: "2026-06-01", eventName: "大会A", points: 100 },
        { date: "2026-05-01", eventName: "大会B", points: 80 },
      ]),
    ];
    const opp: RankingAppearance[] = [
      appr("age_forest", "M21", 12, [
        { date: "2026-06-01", eventName: "大会A", points: 90 }, // 自分 win (+10)
        { date: "2026-05-01", eventName: "大会B", points: 100 }, // 自分 loss (−20)
      ]),
    ];
    const r = tallyH2H(mine, opp);
    expect(r.total).toEqual({ win: 1, loss: 1, draw: 0 });
    expect(r.avgPointDiff).toBe(-5); // (+10 −20)/2
    expect(r.records[0].date).toBe("2026-06-01"); // 日付降順
  });

  it("同一大会が複数共通クラスに跨っても1戦に重複排除", () => {
    const mine: RankingAppearance[] = [
      appr("age_forest", "M21", 10, [{ date: "2026-06-01", eventName: "全日本", points: 100 }]),
      appr("age_forest", "無差別", 200, [{ date: "2026-06-01", eventName: "全日本", points: 100 }]),
    ];
    const opp: RankingAppearance[] = [
      appr("age_forest", "M21", 12, [{ date: "2026-06-01", eventName: "全日本", points: 90 }]),
      appr("age_forest", "無差別", 210, [{ date: "2026-06-01", eventName: "全日本", points: 90 }]),
    ];
    const r = tallyH2H(mine, opp);
    expect(r.records).toHaveLength(1);
    expect(r.total).toEqual({ win: 1, loss: 0, draw: 0 });
  });

  it("対戦0件は avgPointDiff=null", () => {
    const r = tallyH2H([appr("age_forest", "M21", 10, [{ date: "2026-06-01", eventName: "X", points: 100 }])], []);
    expect(r.records).toHaveLength(0);
    expect(r.avgPointDiff).toBeNull();
  });
});
