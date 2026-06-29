import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSplitListDetailed } from "../../scraper/lapcenter-detail";
import type { LapCenterPerformance } from "../../analysis/types";
import { buildLegView, legLabel, fmtSignedSeconds } from "../leg-analysis";

const html = readFileSync(
  fileURLToPath(
    new URL("../../scraper/__tests__/fixtures/lapcenter_splitlist_9534_c0.html", import.meta.url),
  ),
  "utf8",
);
const runners = parseSplitListDetailed(html);

describe("legLabel / fmtSignedSeconds", () => {
  it("レッグ表記", () => {
    expect(legLabel(0, 16)).toBe("S→1");      // index0 = スタート→1
    expect(legLabel(11, 16)).toBe("11→12");   // index11 = 12番目のレッグ
    expect(legLabel(12, 16)).toBe("12→13");
    expect(legLabel(15, 16)).toBe("15→F");    // 最終レッグ → ゴール
  });
  it("符号付き秒", () => {
    expect(fmtSignedSeconds(161)).toBe("+2:41");
    expect(fmtSignedSeconds(-7)).toBe("-0:07");
    expect(fmtSignedSeconds(0)).toBe("0:00");
    expect(fmtSignedSeconds(null)).toBe("—");
  });
});

describe("buildLegView: 主役の選択", () => {
  it("subjectName 未指定なら優勝者", () => {
    const v = buildLegView(runners)!;
    expect(v.subject.rank).toBe(1);
    expect(v.legCount).toBe(16);
    expect(v.n).toBe(runners.filter((r) => r.rank != null).length); // 完走者数（MP等は除外）
  });
  it("subjectName 指定でその選手", () => {
    const v = buildLegView(runners, "白知穎")!;
    expect(v.subject.name).toBe("白知穎");
    expect(v.subject.rank).toBe(7);
  });
});

describe("buildLegView: レッグ・ミス", () => {
  const v = buildLegView(runners, "白知穎")!;
  it("各レッグに基準・ロス・区間順位", () => {
    expect(v.legs.length).toBe(16);
    const first = v.legs[0];
    expect(first.label).toBe("S→1");
    expect(typeof first.lossSec).toBe("number");
    expect(first.lossStr.startsWith("+") || first.lossStr.startsWith("-") || first.lossStr === "0:00").toBe(true);
  });
  it("最大ミスは S→1（+2:41 相当）", () => {
    expect(v.topMistakes.length).toBeGreaterThan(0);
    expect(v.topMistakes[0].label).toBe("S→1");
    expect(v.topMistakes[0].lossSec).toBeGreaterThan(150);
    // 大ミス上位は isTopMiss
    expect(v.legs[v.topMistakes[0].index].isTopMiss).toBe(true);
  });
  it("ノーミス推定順位が出る", () => {
    expect(v.idealRank).not.toBeNull();
    expect(v.idealRank!).toBeGreaterThanOrEqual(1);
  });
  it("累積ロスは各CPの符号付き累計（長さ=レッグ数・末尾=合計）", () => {
    expect(v.cumulativeLoss.length).toBe(v.legCount);
    const sum = v.legs.reduce((s, l) => s + l.lossSec, 0);
    expect(v.cumulativeLoss[v.cumulativeLoss.length - 1]).toBeCloseTo(sum, 5);
    // 単調に積み上がる地点（大ミス直後）で増加していること
    const big = v.topMistakes[0].index;
    if (big > 0) expect(v.cumulativeLoss[big]).toBeGreaterThan(v.cumulativeLoss[big - 1]);
  });
});

describe("buildLegView: 自分の同種目平均との差（Forest/Sprint 分離）", () => {
  const history: LapCenterPerformance[] = [
    { d: "2026-01-01", e: "A", c: "MA", s: 100, m: 9, t: "forest" },
    { d: "2026-02-01", e: "B", c: "MA", s: 104, m: 11, t: "forest" },
    { d: "2026-03-01", e: "C", c: "MA", s: 120, m: 3, t: "sprint" }, // sprint は混ぜない
  ];

  it("Forest レースでは Forest 履歴のみ平均（sprint を除外）", () => {
    const v = buildLegView(runners, "白知穎", { discipline: "forest", history })!;
    expect(v.self.discipline).toBe("forest");
    expect(v.self.sampleSize).toBe(2); // forest 2件のみ
    expect(v.self.avgSpeed).toBe(102); // (100+104)/2
    expect(v.self.avgLossRate).toBe(10); // (9+11)/2
    // delta = subject − avg（符号確認）
    expect(v.self.speedDelta).toBe(Math.round((v.subject.speed! - 102) * 10) / 10);
    expect(v.self.lossRateDelta).toBe(Math.round((v.subject.lossRate! - 10) * 10) / 10);
  });

  it("現レース日（excludeDate）は基準から除外", () => {
    const v = buildLegView(runners, "白知穎", {
      discipline: "forest",
      history: [...history, { d: "2026-04-01", e: "now", c: "MA", s: 999, m: 99, t: "forest" }],
      excludeDate: "2026-04-01",
    })!;
    expect(v.self.sampleSize).toBe(2); // 追加した現レース行は除外
    expect(v.self.avgSpeed).toBe(102);
  });

  it("history 無しなら self は null 値", () => {
    const v = buildLegView(runners, "白知穎")!;
    expect(v.self.discipline).toBeNull();
    expect(v.self.speedDelta).toBeNull();
    expect(v.self.sampleSize).toBe(0);
  });
});

describe("buildLegView: relay-first 健全性ガード", () => {
  it("主役の per-leg 配列長が不整合なら null（黙って穴埋めしない）", () => {
    const bad = {
      index: 0, name: "X", club: "", runnerId: "0", rank: 1, result: "0:03:00", start: "10:00:00",
      speed: 100, lossRate: 0, totalRelative: 100, totalLossTime: "0:00", idealTime: "3:00",
      lapTime: ["1:00", "1:00", "1:00"], // 3
      lapRank: [1, 1], // 2 ← 不整合
      elapsedTime: ["1:00", "2:00", "3:00"],
      elapsedRank: [1, 1, 1],
      legLossTime: ["0:00", "0:00", "0:00"],
      legSpeed: [100, 100, 100],
    };
    expect(buildLegView([bad as never])).toBeNull();
  });
});
