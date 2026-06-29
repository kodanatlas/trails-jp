import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseSplitListDetailed,
  lapStrToSeconds,
  deriveAve3Seconds,
} from "../lapcenter-detail";

// 実データ fixture: mulka2 LapCenter split-list.jsp（event=9534, class=0, 8名完走）
const html = readFileSync(
  fileURLToPath(new URL("./fixtures/lapcenter_splitlist_9534_c0.html", import.meta.url)),
  "utf8",
);

const runners = parseSplitListDetailed(html);
const winner = runners[0];

describe("lapStrToSeconds", () => {
  it("m:ss / h:mm:ss / 負値 / 空 を変換", () => {
    expect(lapStrToSeconds("1:06")).toBe(66);
    expect(lapStrToSeconds("0:11:13")).toBe(673);
    expect(lapStrToSeconds("-0:07")).toBe(-7);
    expect(lapStrToSeconds("")).toBeNull();
    expect(lapStrToSeconds(null)).toBeNull();
  });
});

describe("parseSplitListDetailed: 構造", () => {
  it("全 8 名をパースする", () => {
    expect(runners.length).toBe(8);
  });
  it("優勝者は rank=1・16 レッグ", () => {
    expect(winner.rank).toBe(1);
    expect(winner.lapTime.length).toBe(16);
  });
  it("per-leg 配列の長さが揃う", () => {
    const L = winner.lapTime.length;
    for (const arr of [winner.lapRank, winner.elapsedTime, winner.elapsedRank, winner.legLossTime, winner.legSpeed]) {
      expect(arr.length).toBe(L);
    }
  });
  it("負の legLossTime（ミスなしレッグ）を符号付きで保持", () => {
    expect(winner.legLossTime.some((t) => (lapStrToSeconds(t) ?? 0) < 0)).toBe(true);
  });
});

// LapCenter モデル再現（§3）— パース結果が LapCenter の値の意味と整合することを回帰固定
describe("parseSplitListDetailed: LapCenter 恒等式の再現", () => {
  it("idealTime = result − totalLossTime", () => {
    const res = lapStrToSeconds(winner.result)!;
    const loss = lapStrToSeconds(winner.totalLossTime)!;
    const ideal = lapStrToSeconds(winner.idealTime)!;
    expect(Math.abs(ideal - (res - loss))).toBeLessThanOrEqual(1);
  });

  it("Σ max(0, legLossTime) = totalLossTime", () => {
    const posSum = winner.legLossTime.reduce((s, t) => s + Math.max(0, lapStrToSeconds(t) ?? 0), 0);
    expect(Math.abs(posSum - lapStrToSeconds(winner.totalLossTime)!)).toBeLessThanOrEqual(1);
  });

  it("Ave3 は legSpeed から逆算するとレッグ共通（丸め差のみ）", () => {
    const L = winner.lapTime.length;
    let maxSpread = 0;
    for (let l = 0; l < L; l++) {
      const est = runners
        .map((r) => deriveAve3Seconds(r.lapTime[l], r.legSpeed[l]))
        .filter((v): v is number => v != null && Number.isFinite(v));
      if (est.length >= 2) maxSpread = Math.max(maxSpread, Math.max(...est) - Math.min(...est));
    }
    expect(maxSpread).toBeLessThanOrEqual(2.5);
  });
});

// メトリクス方向の罠（reference: LapCenter指標の向き）— 出荷ブロッキングのガード
describe("方向ガード: speed は小さいほど速い（優勝者≈最小）", () => {
  it("優勝者の巡航速度が完走者中ほぼ最小", () => {
    const fin = runners.filter((r) => r.rank != null && r.speed != null) as Array<{ speed: number }>;
    const minSpeed = Math.min(...fin.map((r) => r.speed));
    expect(winner.speed!).toBeLessThanOrEqual(minSpeed + 0.05);
  });
});
