import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseRelayTeams,
  parseSplitListDetailed,
  lapStrToSeconds,
  deriveAve3Seconds,
} from "../lapcenter-detail";

// 実データ fixture: mulka2 LapCenter split-list.jsp（event=9534, class=0, 8名完走）
const html = readFileSync(
  fileURLToPath(new URL("./fixtures/lapcenter_splitlist_9534_c0.html", import.meta.url)),
  "utf8",
);
const realRelayHtml = readFileSync(
  fileURLToPath(new URL("./fixtures/relay-result-list-9435.html", import.meta.url)),
  "utf8",
);

const runners = parseSplitListDetailed(html);
const winner = runners[0];

const relayHtml = `
  <table>
    <tr>
      <td><b>筑波大学51期&nbsp;A</b><br>7:29:56 (229)</td>
      <td><span>佐々木 晴都</span> / <b>12AD</b><br>1:00:02 / 198 1:00:02 /</td>
      <td>橋本 春 / 12BC<br>1:18:36 / 198 2:18:38 /</td>
      <td>鈴木 健太 / 7F<br>0:40:04 / 70 7:29:56 /</td>
    </tr>
    <tr>
      <td>筑波大学51期 B<br><b>7:40:01</b><br>(230)</td>
      <td>鈴木　健太 / 4G 0:42:00 / 72 7:40:01 /</td>
    </tr>
  </table>
`;

describe("parseRelayTeams", () => {
  const teams = parseRelayTeams(relayHtml);

  it("先頭セルの総合タイムと順位を除き、チーム名だけを返す", () => {
    expect(teams.get("佐々木晴都|12AD")).toBe("筑波大学51期 A");
  });

  it("同一チームの複数走者をそれぞれチーム名へ紐づける", () => {
    expect(teams.get("佐々木晴都|12AD")).toBe("筑波大学51期 A");
    expect(teams.get("橋本春|12BC")).toBe("筑波大学51期 A");
  });

  it("同姓同名をクラス名で区別する", () => {
    expect(teams.get("鈴木健太|7F")).toBe("筑波大学51期 A");
    expect(teams.get("鈴木健太|4G")).toBe("筑波大学51期 B");
  });
});

describe("parseRelayTeams: 実サイト HTML", () => {
  const teams = parseRelayTeams(realRelayHtml);
  const rankedTeamRunners = [
    "山崎葵|12BC",
    "森清星也|12AD",
    "永山遼真|3G",
    "及川悠太郎|4E",
    "斉藤大己|5F",
    "樋口佳那|6",
    "加藤賢斗|7H",
  ];
  const teamARunners = [
    "佐々木晴都|12AD",
    "橋本春|12BC",
    "宮川日向|3G",
    "山田雄飛|4E",
    "友田りさ|5H",
    "井川泰成|6",
    "鈴木健太|7F",
  ];
  const teamBRunners = [
    "松本修汰|12AD",
    "徳倉朋夏|12BC",
    "高木浩太|3E",
    "鈴木健太|4G",
    "松本修汰|5H",
    "三宅希々葉|6",
    "佐々木晴都|7F",
  ];

  it("順位セルを飛ばし、最初に改行を含むセルからチーム名を抽出する", () => {
    expect(teams.get("山崎葵|12BC")).toBe("筑波大学体育会オリエンテーリング部 A");
    expect(teams.get("鈴木健太|7F")).toBe("筑波大学51期 A");
    expect(teams.get("鈴木健太|4G")).toBe("筑波大学51期 B");
  });

  it("チーム名に順位・総合タイム・総合順位・DISQを含めない", () => {
    const teamNames = [...new Set(teams.values())];
    expect(teamNames).toEqual([
      "筑波大学体育会オリエンテーリング部 A",
      "筑波大学51期 A",
      "筑波大学51期 B",
    ]);
    expect(teamNames).not.toContain("1");
    expect(teamNames.every((name) => !/3:42:15|\(4\)|DISQ/.test(name))).toBe(true);
  });

  it("3チームそれぞれの7走者すべてを同じチーム名へ紐づける", () => {
    for (const runner of rankedTeamRunners) {
      expect(teams.get(runner)).toBe("筑波大学体育会オリエンテーリング部 A");
    }
    for (const runner of teamARunners) expect(teams.get(runner)).toBe("筑波大学51期 A");
    for (const runner of teamBRunners) expect(teams.get(runner)).toBe("筑波大学51期 B");
    expect(teams.size).toBe(21);
  });

  it("同姓同名をクラス名で別チームに分ける", () => {
    expect(teams.get("鈴木健太|7F")).toBe("筑波大学51期 A");
    expect(teams.get("鈴木健太|4G")).toBe("筑波大学51期 B");
  });
});

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
