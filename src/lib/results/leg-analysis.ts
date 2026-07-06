// 結果分析「レッグカード」ビューのビューモデル生成（純関数・relay-first）。
// LapCenter の per-leg relay 値（legLossTime=ミス, legSpeed, lapRank, Ave3）をそのまま使い、
// 表示に必要な形へ整形するだけ。再計算（median polish / EM 等）はしない。
// docs/plans/2026-06-29_results-analysis-methodology.md §8.1 準拠。
//
// メトリクス方向の罠: legSpeed/speed は小さいほど速い＝良い。legLossTime は小さい・負ほど良い。

import {
  type LapCenterRunnerDetail,
  lapStrToSeconds,
  deriveAve3Seconds,
} from "../scraper/lapcenter-detail";
import type { LapCenterPerformance } from "../analysis/types";

export interface LegCell {
  label: string;            // "S→1", "12→13", "22→F"
  lap: string;              // 表示用スプリット "10:26"
  lapSec: number | null;
  ave3Sec: number | null;   // レッグ基準（上位3平均）
  ave3Str: string;          // "8:00"
  lossSec: number;          // 符号付き秒（正=ロス/ミス、負=基準より速い）
  lossStr: string;          // 表示 "+2:01" / "-0:04" / "0:00"
  lapRank: number | null;   // そのレッグの区間順位
  legSpeed: number | null;  // 相対ペース（100=Ave3, 小さいほど速い）
  isTopMiss: boolean;       // ロス上位3レッグ
  fieldMedianLossSec: number | null; // フィールド全体のロス中央値（罠レッグ判定用・高い=コースが難しい）
}

export interface LegViewSubject {
  name: string;
  club: string;
  rank: number | null;
  result: string;
  resultSec: number | null;
  speed: number | null;
  lossRate: number | null;
  idealTime: string;
  idealSec: number | null;
  totalLossTime: string;
}

/**
 * 自分の同種目（Forest / Sprint）平均との比較。Forest と Sprint は混ぜない。
 * delta が負＝自分の平均より良い（速い / ミス少）。履歴が無ければ各値 null。
 */
export interface SelfComparison {
  discipline: "forest" | "sprint" | null;
  avgSpeed: number | null;      // 自分の同種目平均 巡航速度
  avgLossRate: number | null;   // 自分の同種目平均 ミス率
  speedDelta: number | null;    // このレース − 自分平均（負＝平均より速い＝良い）
  lossRateDelta: number | null; // このレース − 自分平均（負＝平均よりミス少＝良い）
  sampleSize: number;           // 平均の母数（現レースを除く同種目レース数）
}

export interface LegView {
  subject: LegViewSubject;
  n: number;                // 完走者数（rank 付き）
  legCount: number;
  legs: LegCell[];
  idealRank: number | null; // ノーミスなら推定◯位（idealTime を他者の実記録と比較）
  topMistakes: { index: number; label: string; lossSec: number; lossStr: string }[];
  self: SelfComparison;     // 自分の同種目平均との比較（種目別）
  cumulativeLoss: number[]; // 各CP時点の累積ロス秒（積み上げカーブ用・legs と同順）
}

export interface LegPrize {
  legIndex: number;
  label: string;
  winner: string | null; // そのレッグの最速（lapRank==1）
  club: string;
  time: string; // 区間タイム
}

export interface LegPrizeBoard {
  legs: LegPrize[];
  tally: { name: string; club: string; count: number }[]; // 区間賞 獲得数ランキング
  legCount: number;
}

/** ③ 区間賞ボード: 各レッグの最速（lapRank==1）と、選手別の区間賞獲得数ランキング。 */
export function buildLegPrizes(runners: LapCenterRunnerDetail[]): LegPrizeBoard | null {
  if (runners.length === 0) return null;
  const finishers = runners.filter((r) => r.rank != null);
  // 区間賞(レッグ最速)は overall DNF/MP でも leg を最速で走れば獲得しうるため全走者から拾う。
  // コース長(legCount)はフルコース＝完走者基準で決める（完走者が居なければ全走者の最大）。
  const legCount = Math.max(...(finishers.length ? finishers : runners).map((r) => r.lapRank.length), 0);
  if (legCount === 0) return null;

  const legs: LegPrize[] = [];
  const tally = new Map<string, { name: string; club: string; count: number }>();
  for (let l = 0; l < legCount; l++) {
    const winners = runners.filter((r) => r.lapRank[l] === 1);
    const w = winners[0] ?? null;
    legs.push({
      legIndex: l,
      label: legLabel(l, legCount),
      winner: w ? w.name : null,
      club: w ? w.club : "",
      time: w && w.lapTime[l] != null ? w.lapTime[l] : "",
    });
    for (const win of winners) {
      const key = normalizeName(win.name);
      const cur = tally.get(key);
      if (cur) cur.count++;
      else tally.set(key, { name: win.name, club: win.club, count: 1 });
    }
  }
  const tallyArr = [...tally.values()].sort((a, b) => b.count - a.count);
  return { legs, tally: tallyArr, legCount };
}

/** 自分の同種目平均との比較を算出。history は選手の LC 全履歴、discipline は現レースの種目。 */
function buildSelfComparison(
  subject: LapCenterRunnerDetail,
  self: { discipline: "forest" | "sprint"; history: LapCenterPerformance[]; excludeDate?: string } | undefined,
): SelfComparison {
  if (!self) {
    return { discipline: null, avgSpeed: null, avgLossRate: null, speedDelta: null, lossRateDelta: null, sampleSize: 0 };
  }
  // 同種目のみ・現レース（同日）は基準から除外して自己ベースラインの自己汚染を防ぐ
  const sameDisc = self.history.filter(
    (h) => h.t === self.discipline && (!self.excludeDate || h.d !== self.excludeDate),
  );
  const speeds = sameDisc.map((h) => h.s).filter((v) => Number.isFinite(v));
  const misses = sameDisc.map((h) => h.m).filter((v) => Number.isFinite(v));
  const avgS = mean(speeds);
  const avgM = mean(misses);
  return {
    discipline: self.discipline,
    avgSpeed: round1(avgS),
    avgLossRate: round1(avgM),
    speedDelta: avgS != null && subject.speed != null ? round1(subject.speed - avgS) : null,
    lossRateDelta: avgM != null && subject.lossRate != null ? round1(subject.lossRate - avgM) : null,
    sampleSize: sameDisc.length,
  };
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round1(x: number | null): number | null {
  return x == null ? null : Math.round(x * 10) / 10;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** "S→1" / "i→i+1" / "(L-1)→F" のレッグ表記。 */
export function legLabel(index: number, legCount: number): string {
  if (index === 0) return "S→1";
  if (index === legCount - 1) return `${legCount - 1}→F`;
  return `${index}→${index + 1}`;
}

/** 符号付き秒を "m:ss"（先頭符号つき）で表示。0 は "0:00"。 */
export function fmtSignedSeconds(sec: number | null): string {
  if (sec == null) return "—";
  const sign = sec > 0 ? "+" : sec < 0 ? "-" : "";
  const a = Math.abs(Math.round(sec));
  const m = Math.floor(a / 60);
  const s = a % 60;
  return `${sign}${m}:${String(s).padStart(2, "0")}`;
}

/** 各レッグの基準 Ave3（秒）。フィールド各走者からの逆算値の中央値（rounding に頑健）。 */
export function deriveAve3PerLeg(runners: LapCenterRunnerDetail[], legCount: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let l = 0; l < legCount; l++) {
    const est = runners
      .map((r) => deriveAve3Seconds(r.lapTime[l] ?? "", r.legSpeed[l] ?? null))
      .filter((v): v is number => v != null && Number.isFinite(v))
      .sort((a, b) => a - b);
    out.push(est.length ? est[Math.floor(est.length / 2)] : null);
  }
  return out;
}

/** 名前マッチ用の正規化（空白除去）。クライアントと共有して二重定義を防ぐ（レビュー H）。
 *  ※全角半角/大小文字の吸収は lc_performances の name 同期元統一が前提のため別途（レビュー P・人間判断）。 */
export function normalizeName(s: string): string {
  return s.replace(/\s+/g, "");
}

/**
 * ビューモデル生成。subjectName 未指定なら優勝者（rank=1, 無ければ先頭）を主役にする。
 * self を渡すと「自分の同種目平均との差」（Forest/Sprint 別）を併記できる。
 */
export function buildLegView(
  runners: LapCenterRunnerDetail[],
  subjectName?: string,
  self?: { discipline: "forest" | "sprint"; history: LapCenterPerformance[]; excludeDate?: string },
): LegView | null {
  if (runners.length === 0) return null;

  const finishers = runners.filter((r) => r.rank != null);
  const n = finishers.length;

  let subject: LapCenterRunnerDetail | undefined;
  if (subjectName) {
    const key = normalizeName(subjectName);
    subject = runners.find((r) => normalizeName(r.name) === key);
  }
  if (!subject) {
    subject = finishers.find((r) => r.rank === 1) ?? finishers[0] ?? runners[0];
  }
  if (!subject) return null;

  const legCount = subject.lapTime.length;
  // relay-first 健全性: 主役の per-leg 配列長が相互不整合なら黙って穴埋めせず描画しない（fail-fast・レビュー C）
  if (
    [subject.lapRank, subject.elapsedTime, subject.elapsedRank, subject.legLossTime, subject.legSpeed].some(
      (a) => a.length !== legCount,
    )
  ) {
    console.warn(`[leg-analysis] inconsistent per-leg array lengths for "${subject.name}" — skipping view`);
    return null;
  }
  const ave3 = deriveAve3PerLeg(runners, legCount);

  const losses = subject.legLossTime.map((t) => lapStrToSeconds(t) ?? 0);
  const topMistakes = losses
    .map((lossSec, index) => ({ index, lossSec }))
    .filter((x) => x.lossSec > 0)
    .sort((a, b) => b.lossSec - a.lossSec)
    .slice(0, 3)
    .map((x) => ({
      index: x.index,
      label: legLabel(x.index, legCount),
      lossSec: x.lossSec,
      lossStr: fmtSignedSeconds(x.lossSec),
    }));
  const topMissSet = new Set(topMistakes.map((x) => x.index));

  // 罠レッグ判定: 各レッグのフィールド全体のロス中央値（全完走者の legLossTime[l]）。
  // 高い=多くの走者が自分のペース基準で遅れた=コースが難しい(罠)。≈0=易しい→自分のロスは自分のミス。
  const fieldMedianLossByLeg: (number | null)[] = [];
  for (let l = 0; l < legCount; l++) {
    const vals = finishers
      .map((r) => (r.legLossTime[l] != null ? lapStrToSeconds(r.legLossTime[l]) : null))
      .filter((v): v is number => v != null);
    fieldMedianLossByLeg.push(median(vals));
  }

  const legs: LegCell[] = subject.lapTime.map((lap, i) => {
    const lossSec = losses[i] ?? 0;
    return {
      label: legLabel(i, legCount),
      lap,
      lapSec: lapStrToSeconds(lap),
      ave3Sec: ave3[i],
      ave3Str: ave3[i] != null ? fmtSignedSeconds(ave3[i]).replace(/^\+/, "") : "—",
      lossSec,
      lossStr: fmtSignedSeconds(lossSec),
      lapRank: subject.lapRank[i] ?? null,
      legSpeed: subject.legSpeed[i] ?? null,
      isTopMiss: topMissSet.has(i),
      fieldMedianLossSec: fieldMedianLossByLeg[i],
    };
  });

  // 累積ロス（各CP時点での legLossTime の符号付き累計）— 積み上げカーブ用
  const cumulativeLoss: number[] = [];
  {
    let acc = 0;
    for (const leg of legs) {
      acc += leg.lossSec;
      cumulativeLoss.push(acc);
    }
  }

  // ノーミス推定順位 =「この選手がノーミスで走った場合、実際の結果に対して何位だったか」。
  // 自分の理想タイムを他者の"実記録"と比較（単一選手の深掘り専用の自己仮定。グリッドでは各列が
  // 全員"実フィールドに勝てる"判定になり複数1位になるため、グリッド側は順位を出さない）。
  const idealSec = lapStrToSeconds(subject.idealTime);
  const idealRank =
    idealSec == null
      ? null
      : 1 +
        finishers.filter((r) => {
          if (normalizeName(r.name) === normalizeName(subject.name)) return false; // 自分は除外
          const ra = lapStrToSeconds(r.result);
          return ra != null && ra < idealSec;
        }).length;

  return {
    subject: {
      name: subject.name,
      club: subject.club,
      rank: subject.rank,
      result: subject.result,
      resultSec: lapStrToSeconds(subject.result),
      speed: subject.speed,
      lossRate: subject.lossRate,
      idealTime: subject.idealTime,
      idealSec,
      totalLossTime: subject.totalLossTime,
    },
    n,
    legCount,
    legs,
    idealRank,
    topMistakes,
    self: buildSelfComparison(subject, self),
    cumulativeLoss,
  };
}

// ---- ⑤ 順位が動いたレッグ（レース展開・relay-first） ----
//
// 主指標 shuffle = 各レッグでの elapsedRank（LapCenter の CP 通過順位・relay）の
// 1人あたり平均変動量。仮定ゼロの記述統計で、「このレッグで順位表がどれだけ動いたか」を測る。
// 単独クラッシュも順位変動として自然に現れる。
//
// 副指標 C(l) = Σ(R_l−mean)((T−R_l)−mean) / Σ(T−mean)²。
//   R = LapCenter legLossTime（符号付き残差・relay）、T = R の行和（signed residual 合計。
//   最終タイムは走力・レッグ長に支配され、totalLossTime=Σmax(0,·) は非線形で
//   leave-self-out と相性が悪い）。分子分母を同一除数の中心化積和で書き ddof 依存を排除。
//   「合計から自レッグを除く」構成のため単独クラッシュレッグが1位になりにくい一方、
//   本当に1本で差がついたレッグも拾わない（→だから主指標にしない）。
//   speed が同一レースのレッグ群から推定されるため自己影響の完全除去ではない（脚注要）。
//   長いレッグほど残差分散が構造的に大きい（レッグ長との交絡・脚注要）。
// コホートは「優勝タイム+25%以内の完走者・全レッグ parseable」（結果による選択＝
//   表示は常に『上位完走者 n=K での傾向』と限定し、クラス全体の断定をしない）。
// 百分率表現は全面禁止（方法論 must-fix 1: ΣC(l)=1 撤回済み・相対バーのみ）。

export const TOP_CONTENDER_FACTOR = 1.25;

export interface LegImpact {
  legIndex: number;
  label: string;
  /** 1人あたり平均順位変動（完走者・elapsedRank の |Δ|）。レッグ1(S→1)と算出不能は null */
  shuffle: number | null;
  /** shuffle の相対バー 0..1（最大値正規化） */
  shuffleBar: number;
  /** ミス残差連動度（相対比較専用の指標値）。コホート不足・縮退は null */
  c: number | null;
  /** c の相対バー -1..1（max|c| 正規化） */
  cBar: number;
  /** 参考: 区間生タイムと最終タイムの順位相関（Spearman・同順位平均） */
  rho: number | null;
  /** このレッグで首位（elapsedRank=1）の走者が入れ替わったか（両CPで首位が特定できた場合のみ true になりうる） */
  leaderChanged: boolean;
  /** このレッグで最も順位を動かした走者（relay の elapsedRank 値そのまま）。該当なしは null */
  biggestMove: { name: string; from: number; to: number } | null;
}

export interface LegImpactView {
  finisherCount: number;    // shuffle の母数（完走者）
  cohortSize: number;       // C(l)/ρ の母数（優勝+25%以内・全レッグ parseable）
  excludedIncomplete: number; // コホート条件は満たすが欠測レッグで除外された人数
  provisional: boolean;     // cohortSize < 15 → C/ρ は参考扱い
  legs: LegImpact[];        // 全レッグ（コース順）
  topShuffle: LegImpact[];  // shuffle 上位5
}

function mode(xs: number[]): number {
  const freq = new Map<number, number>();
  for (const x of xs) freq.set(x, (freq.get(x) ?? 0) + 1);
  let best = xs[0] ?? 0;
  let bestCount = 0;
  for (const [v, c] of freq) {
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best;
}

function centeredMean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Spearman 順位相関（同順位は平均順位）。どちらかの分散が 0 なら null */
export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const rank = (arr: number[]): number[] => {
    const idx = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(arr.length).fill(0);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[idx[k].i] = avg;
      i = j + 1;
    }
    return ranks;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mx = centeredMean(rx);
  const my = centeredMean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  if (dx < 1e-9 || dy < 1e-9) return null;
  return num / Math.sqrt(dx * dy);
}

/**
 * ⑤ 順位が動いたレッグ。完走者 8 名未満・リレー系クラス名は null（非表示）。
 * shuffle はレッグ1（スタート直後・前 CP 順位が存在しない）は null。
 */
export function buildLegImpact(
  runners: LapCenterRunnerDetail[],
  ctx?: { eventName?: string | null; className?: string | null }
): LegImpactView | null {
  // リレー/ペア系はレッグ index が物理的に共通コースでない（フォーク）ため対象外。
  // 構造検出（スプリット構造がコース共通と矛盾するクラスの検出）は未実装＝名前ベースの抑制のみ。
  if (/リレー|relay|ペア|チーム/i.test(`${ctx?.eventName ?? ""} ${ctx?.className ?? ""}`)) return null;

  const finishers = runners.filter((r) => r.rank != null && r.lapTime.length > 0);
  if (finishers.length < 8) return null;
  const legCount = mode(finishers.map((r) => r.lapTime.length));
  const field = finishers.filter((r) => r.lapTime.length === legCount);
  if (field.length < 8 || legCount < 2) return null;

  // --- 主指標: shuffle（elapsedRank の平均変動・レッグ2以降） ---
  // あわせて初見向けの具体文脈を抽出: 首位交代の有無・そのレッグで最も順位を動かした走者。
  // いずれも relay の elapsedRank 値そのまま（順位は LapCenter が全走者に対して算出したもの）。
  const shuffleRaw: (number | null)[] = new Array(legCount).fill(null);
  const leaderChangedRaw: boolean[] = new Array(legCount).fill(false);
  const biggestMoveRaw: ({ name: string; from: number; to: number } | null)[] = new Array(legCount).fill(null);
  for (let l = 1; l < legCount; l++) {
    let sum = 0;
    let valid = 0;
    let best: { name: string; from: number; to: number } | null = null;
    let prevLeader: string | null = null;
    let curLeader: string | null = null;
    for (const r of field) {
      const prev = r.elapsedRank[l - 1];
      const cur = r.elapsedRank[l];
      if (prev == null || cur == null) continue;
      sum += Math.abs(cur - prev);
      valid++;
      if (best == null || Math.abs(cur - prev) > Math.abs(best.to - best.from)) {
        best = { name: r.name, from: prev, to: cur };
      }
      if (prev === 1) prevLeader = r.name;
      if (cur === 1) curLeader = r.name;
    }
    shuffleRaw[l] = valid >= 8 ? sum / valid : null;
    // 首位交代: 両CPの首位が field 内で特定でき、かつ別人のときのみ true
    // （真の首位が field 外＝後の DNF 等なら特定不能として false のまま）
    leaderChangedRaw[l] = prevLeader != null && curLeader != null && prevLeader !== curLeader;
    biggestMoveRaw[l] = best != null && best.from !== best.to ? best : null;
  }

  // --- 副指標: C(l)・ρ（優勝+25% コホート・全レッグ parseable） ---
  const withResult = field
    .map((r) => ({ r, res: lapStrToSeconds(r.result) }))
    .filter((x): x is { r: LapCenterRunnerDetail; res: number } => x.res != null);
  const winnerSec = withResult.length ? Math.min(...withResult.map((x) => x.res)) : null;
  let excludedIncomplete = 0;
  const cohort: { loss: number[]; laps: number[]; res: number }[] = [];
  if (winnerSec != null) {
    for (const x of withResult) {
      if (x.res > TOP_CONTENDER_FACTOR * winnerSec) continue;
      const loss = x.r.legLossTime.map(lapStrToSeconds);
      const laps = x.r.lapTime.map(lapStrToSeconds);
      if (loss.some((v) => v == null) || laps.some((v) => v == null)) {
        excludedIncomplete++;
        continue;
      }
      cohort.push({ loss: loss as number[], laps: laps as number[], res: x.res });
    }
  }
  const K = cohort.length;

  let cValues: (number | null)[] = new Array(legCount).fill(null);
  let rhoValues: (number | null)[] = new Array(legCount).fill(null);
  if (K >= 8) {
    const T = cohort.map((c) => c.loss.reduce((a, b) => a + b, 0));
    const mT = centeredMean(T);
    const denom = T.reduce((a, t) => a + (t - mT) ** 2, 0);
    if (denom > 1e-9) {
      cValues = Array.from({ length: legCount }, (_, l) => {
        const x = cohort.map((c) => c.loss[l]);
        const y = cohort.map((c, i) => T[i] - c.loss[l]); // 合計から自レッグを除く
        const mx = centeredMean(x);
        const my = centeredMean(y);
        let num = 0;
        for (let i = 0; i < x.length; i++) num += (x[i] - mx) * (y[i] - my);
        return num / denom;
      });
    }
    rhoValues = Array.from({ length: legCount }, (_, l) =>
      spearman(cohort.map((c) => c.laps[l]), cohort.map((c) => c.res))
    );
  }

  const maxShuffle = Math.max(...shuffleRaw.map((v) => v ?? 0), 1e-9);
  const maxAbsC = Math.max(...cValues.map((v) => Math.abs(v ?? 0)), 1e-9);
  const legs: LegImpact[] = Array.from({ length: legCount }, (_, l) => ({
    legIndex: l,
    label: legLabel(l, legCount),
    shuffle: shuffleRaw[l] == null ? null : Math.round(shuffleRaw[l]! * 100) / 100,
    shuffleBar: shuffleRaw[l] == null ? 0 : shuffleRaw[l]! / maxShuffle,
    c: cValues[l] == null ? null : Math.round(cValues[l]! * 1000) / 1000,
    cBar: cValues[l] == null ? 0 : cValues[l]! / maxAbsC,
    rho: rhoValues[l] == null ? null : Math.round(rhoValues[l]! * 100) / 100,
    leaderChanged: leaderChangedRaw[l],
    biggestMove: biggestMoveRaw[l],
  }));

  const topShuffle = legs
    .filter((l) => l.shuffle != null)
    .sort((a, b) => b.shuffle! - a.shuffle!)
    .slice(0, 5);
  if (topShuffle.length === 0) return null;

  return {
    finisherCount: field.length,
    cohortSize: K,
    excludedIncomplete,
    provisional: K < 15,
    legs,
    topShuffle,
  };
}
