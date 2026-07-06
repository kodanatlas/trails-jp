import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSplitListDetailed, lapStrToSeconds } from "../../scraper/lapcenter-detail";
import type { LapCenterPerformance } from "../../analysis/types";
import { buildLegView, buildLegPrizes, legLabel, fmtSignedSeconds } from "../leg-analysis";

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

describe("buildLegView: 罠レッグ判定（フィールドのロス中央値）", () => {
  const v = buildLegView(runners, "白知穎")!;
  const finishers = runners.filter((r) => r.rank != null);
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  it("各レッグに fieldMedianLossSec = 全完走者 legLossTime の中央値", () => {
    v.legs.forEach((leg, l) => {
      const vals = finishers
        .map((r) => lapStrToSeconds(r.legLossTime[l]))
        .filter((x): x is number => x != null);
      const expected = vals.length ? med(vals) : null;
      if (expected == null) expect(leg.fieldMedianLossSec).toBeNull();
      else expect(leg.fieldMedianLossSec!).toBeCloseTo(expected, 5);
    });
  });
});

describe("buildLegPrizes: 区間賞ボード", () => {
  const board = buildLegPrizes(runners)!;
  it("レッグ数が一致", () => {
    expect(board).not.toBeNull();
    expect(board.legCount).toBe(16);
    expect(board.legs.length).toBe(16);
  });
  it("各レッグの区間賞は lapRank==1 の選手（全走者=DNF/MP含む）", () => {
    board.legs.forEach((p, l) => {
      const winner = runners.find((r) => r.lapRank[l] === 1); // 完走者に限らない
      expect(p.winner).toBe(winner ? winner.name : null);
    });
  });
  it("獲得数ランキングは降順・合計は区間賞ありレッグ数以上（同着で増）", () => {
    for (let i = 1; i < board.tally.length; i++) {
      expect(board.tally[i - 1].count).toBeGreaterThanOrEqual(board.tally[i].count);
    }
    const total = board.tally.reduce((s, t) => s + t.count, 0);
    expect(total).toBeGreaterThanOrEqual(board.legs.filter((p) => p.winner).length);
  });
});

// ---- ⑤ 順位が動いたレッグ ----

import { buildLegImpact, spearman, TOP_CONTENDER_FACTOR } from "../leg-analysis";
import type { LapCenterRunnerDetail } from "../../scraper/lapcenter-detail";

/** 秒 → "m:ss"（負値対応） */
function sec(s: number): string {
  const neg = s < 0;
  const a = Math.abs(s);
  return `${neg ? "-" : ""}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}

/**
 * 合成フィールド生成: lossMatrix[i][l] = 走者 i のレッグ l のロス秒（基準レッグ 100 秒に加算）。
 * elapsedTime / elapsedRank / lapRank / rank / result はロスから機械的に導出する（フィクスチャ生成）。
 */
function buildField(lossMatrix: number[][]): LapCenterRunnerDetail[] {
  const n = lossMatrix.length;
  const legCount = lossMatrix[0].length;
  const laps = lossMatrix.map((row) => row.map((loss) => 100 + loss));
  const cums = laps.map((row) => {
    const out: number[] = [];
    let acc = 0;
    for (const v of row) { acc += v; out.push(acc); }
    return out;
  });
  const rankAt = (l: number): number[] => {
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => cums[a][l] - cums[b][l]);
    const ranks = new Array(n).fill(0);
    order.forEach((runner, pos) => { ranks[runner] = pos + 1; });
    return ranks;
  };
  const ranksByCp = Array.from({ length: legCount }, (_, l) => rankAt(l));
  const finalRanks = ranksByCp[legCount - 1];
  const legRankAt = (l: number): number[] => {
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => laps[a][l] - laps[b][l]);
    const ranks = new Array(n).fill(0);
    order.forEach((runner, pos) => { ranks[runner] = pos + 1; });
    return ranks;
  };
  const legRanks = Array.from({ length: legCount }, (_, l) => legRankAt(l));

  return lossMatrix.map((row, i) => ({
    index: i,
    name: `選手${i}`,
    club: `クラブ${i % 3}`,
    runnerId: String(i),
    rank: finalRanks[i],
    result: sec(cums[i][legCount - 1]),
    start: "10:00:00",
    speed: 100,
    lossRate: 5,
    totalRelative: 100,
    totalLossTime: sec(row.reduce((a, b) => a + Math.max(0, b), 0)),
    idealTime: sec(cums[i][legCount - 1] - row.reduce((a, b) => a + Math.max(0, b), 0)),
    lapTime: laps[i].map(sec),
    lapRank: Array.from({ length: legCount }, (_, l) => legRanks[l][i]),
    elapsedTime: cums[i].map(sec),
    elapsedRank: Array.from({ length: legCount }, (_, l) => ranksByCp[l][i]),
    legLossTime: row.map(sec),
    legSpeed: laps[i].map(() => 100),
  }));
}

describe("spearman", () => {
  it("完全一致で 1・逆順で -1", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1);
  });
  it("同順位は平均順位で処理", () => {
    const r = spearman([1, 2, 2, 4], [1, 2, 3, 4]);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0.8);
  });
  it("分散ゼロは null", () => {
    expect(spearman([5, 5, 5, 5], [1, 2, 3, 4])).toBeNull();
  });
});

describe("buildLegImpact", () => {
  // 走者12名×6レッグ。レッグ2 = 実力差でソートされるレッグ（loss=i*10）、
  // レッグ4 = 同傾向の弱いソート（loss=i*5）。他は 0。
  const sortingMatrix = Array.from({ length: 12 }, (_, i) => [0, 0, i * 10, 0, i * 5, 0]);

  it("ソートレッグが C(l) の最大・rho も正", () => {
    const v = buildLegImpact(buildField(sortingMatrix))!;
    expect(v).not.toBeNull();
    const byC = [...v.legs].filter((l) => l.c != null).sort((a, b) => b.c! - a.c!);
    expect(byC[0].legIndex).toBe(2);
    expect(v.legs[2].rho).toBeGreaterThan(0.5);
  });

  it("単独クラッシュは shuffle で捕捉され・C(l) の1位にはならない", () => {
    // 中位走者(6)がレッグ5で +120 単独クラッシュ（優勝+25%以内に収まる規模）
    const m = sortingMatrix.map((row) => [...row]);
    m[6] = [...m[6]];
    m[6][5] = m[6][5] + 120;
    const v = buildLegImpact(buildField(m))!;
    expect(v).not.toBeNull();
    // shuffle: クラッシュで順位が動くためレッグ5(最終)が上位に入る
    const topShuffleIdx = v.topShuffle.map((l) => l.legIndex);
    expect(topShuffleIdx).toContain(5);
    // C(l): 合計から自レッグを除く構成のため、単独クラッシュのレッグ5は1位にならない
    const byC = [...v.legs].filter((l) => l.c != null).sort((a, b) => b.c! - a.c!);
    expect(byC[0].legIndex).toBe(2);
  });

  it("レッグ1(S→1) の shuffle は null（前CP順位が存在しない）", () => {
    const v = buildLegImpact(buildField(sortingMatrix))!;
    expect(v.legs[0].shuffle).toBeNull();
  });

  it("ゲート: 完走者7名 → null・8名 → 参考(provisional)", () => {
    expect(buildLegImpact(buildField(sortingMatrix.slice(0, 7)))).toBeNull();
    const v8 = buildLegImpact(buildField(sortingMatrix.slice(0, 8)))!;
    expect(v8).not.toBeNull();
    expect(v8.provisional).toBe(true); // K=8 < 15
  });

  it("コホート: 優勝+25% 超は C の母数から除外（shuffle には残る）", () => {
    const m = sortingMatrix.map((row) => [...row]);
    // 走者11 を大幅に遅くする（result > 優勝+25%）
    m[11] = [0, 200, 200, 200, 200, 200];
    const v = buildLegImpact(buildField(m))!;
    expect(v.finisherCount).toBe(12);
    expect(v.cohortSize).toBeLessThan(12);
  });

  it("欠測レッグの走者は excludedIncomplete に計上", () => {
    const field = buildField(sortingMatrix);
    field[3] = { ...field[3], legLossTime: field[3].legLossTime.map((s, l) => (l === 1 ? "" : s)) };
    const v = buildLegImpact(field)!;
    expect(v.excludedIncomplete).toBe(1);
  });

  it("リレー系クラス名は非表示", () => {
    expect(buildLegImpact(buildField(sortingMatrix), { className: "7人リレー" })).toBeNull();
    expect(buildLegImpact(buildField(sortingMatrix), { eventName: "クラブ対抗Relay" })).toBeNull();
  });

  it("縮退: 全員同タイム（Var(T)=0）→ C は null・view 自体は shuffle があれば返る", () => {
    const flat = Array.from({ length: 10 }, () => [0, 0, 0, 0, 0, 0]);
    const v = buildLegImpact(buildField(flat));
    // 全員同タイム → 順位変動もゼロだが shuffle 値(0)自体は算出される
    if (v) {
      expect(v.legs.every((l) => l.c == null)).toBe(true);
    }
  });

  it("実フィクスチャ(9534 c0)ではコホート不足で null か、返る場合もゲート整合", () => {
    const v = buildLegImpact(runners);
    if (v) {
      expect(v.finisherCount).toBeGreaterThanOrEqual(8);
    } else {
      expect(runners.filter((r) => r.rank != null).length).toBeLessThan(8 / TOP_CONTENDER_FACTOR + 8); // 小フィールド
    }
  });
});
