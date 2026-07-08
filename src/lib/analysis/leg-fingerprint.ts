/**
 * クロスレース「ミスの傾向」（方法論プラン 2026-06-29 層A・ミス指紋）＋信頼度加重トレンドの
 * レース重み生成。純関数のみ（I/O なし）。build スクリプトが lc_leg_splits から呼ぶ。
 *
 * relay-first: 入力は LapCenter の per-leg relay 値のみ。
 * - leg_loss_sec = lap − Ave3·(speed/100)（符号付き・個人巡航ペース基準＝方法論の推奨(B)式）
 * - lap − loss = 自分の巡航ペースでの想定タイム（LapCenter 恒等式・ミス判定の基準）
 * - Ave3 = 100·lap/leg_speed（レッグ長ターシルのみに使用。leg_speed 丸め±0.5%は順位付けに無害）
 *
 * ミス＝閾値判定（コミュニティ定義・方法論 §8 裁定）。閾値 0.30 は日常ばらつき
 * （ρ 中央値 ≈ 6-8%）の 4-5 倍の規約であり、自然な切れ目は存在しない（params で公開）。
 * 慎重な安全ルートのロスも「ミス」に数まれうる（表示側で明記）。
 *
 * パック除染（方法論 line 161）: 時計時刻の境界近接が連続する区間を集団走とみなし
 * 両者のレッグを除外する（リーダー/フォロワー識別なし・除外は標本減のみで偏りを作らない）。
 */

export interface FingerprintParams {
  missRatio: number;
  floors: { forest: number; sprint: number };
  packEps: { forest: number; sprint: number };
  packMinLegs: number;      // 連続レッグ数（境界は +1 本）
  packMaxShare: number;     // レース内パック影響割合がこれを超えたらレース除外
  fdrQ: number;
  minRaces: number;         // 選手ゲート: 採用レース数
  minLegs: number;          // 選手ゲート: 有効レッグ数
  cellMinN: number;         // セルフラグの最小 n
  cellMinRatio: number;     // セルフラグの最小効果量（対自己基準率の比）
  permB: number;            // permutation 反復数（レース層別・決定的シード）
  permSeed: number;
  raceCleanGate: number;    // レースゲート: 除染後クリーンレッグ数（方法論 §109 の 6-8 本）
  fieldNCap: number;        // 重みの出走規模頭打ち（Ave3=上位3平均の情報飽和）
  lag1MinN1: number;
  lag1MinN0: number;
  sevBins: { forest: [number, number]; sprint: [number, number] };
  /** コホート帯数（選手の中央値巡航速度分位。sprint は掲載数が少なく帯セル n を確保するため粗く） */
  cohortBands: { forest: number; sprint: number };
  /** 同姓同名判定: 同日の走行時間帯がこれ以上重複した別レースの存在で別人混在とみなす */
  homonymOverlapSec: number;
  /** 期間比較（Stage 2d）を表示する各期間の最小レース数・最小レッグ数 */
  periodMinRaces: number;
  periodMinLegs: number;
}

export const DEFAULT_PARAMS: FingerprintParams = {
  missRatio: 0.3,
  floors: { forest: 10, sprint: 5 },
  packEps: { forest: 15, sprint: 10 },
  packMinLegs: 3,
  packMaxShare: 0.5,
  fdrQ: 0.1,
  minRaces: 5,
  minLegs: 50,
  cellMinN: 10,
  cellMinRatio: 1.3,
  permB: 400,
  permSeed: 20260707,
  raceCleanGate: 6,
  fieldNCap: 20,
  lag1MinN1: 15,
  lag1MinN0: 30,
  sevBins: { forest: [30, 90], sprint: [15, 45] },
  cohortBands: { forest: 5, sprint: 3 },
  homonymOverlapSec: 300,
  periodMinRaces: 3,
  periodMinLegs: 30,
};

/**
 * リレー・フォーク形式（farsta/motala/バタフライ等）は per-leg 列が単一コースに対応しないため除外。
 * 構造的なフォーク検出は 2026-07-07 に評価の上棄却（陽性対照=実リレー132クラスで信号ゼロ＝
 * Ave3(上位3平均)が短フォーク側に錨を下ろし速い尾には現れない）→ 名前ベースで運用。
 */
const RELAY_RE = /リレー|relay|ペア|チーム|farsta|motala|one.?man|ワンマン|モタラ|ファルスタ|バタフライ|フォーク/i;

/** fetch①（tracked 行）の形 */
export interface TrackedLegRow {
  runner_key: string;
  event_date: string;
  event_name: string;
  class_name: string | null;
  club: string | null;
  race_type: "forest" | "sprint";
  rank: number | null;
  speed: number | null;
  start_time: string | null;
  lap_sec: (number | null)[];
  leg_loss_sec: (number | null)[];
  leg_speed: (number | null)[];
  elapsed_sec: (number | null)[];
  lc_event_id: number;
  lc_class_id: number;
}

/** fetch②（companion 行）の形（tracked 行も companion を兼ねる） */
export interface CompanionRow {
  lc_event_id: number;
  lc_class_id: number;
  runner_index: number;
  start_time: string | null;
  elapsed_sec: (number | null)[];
}

/** レース重み（信頼度加重トレンド用）。d=日付, w=cleanLegs×min(fieldN,cap), r=reliable */
export interface RaceWeight {
  d: string;
  w: number;
  r: 0 | 1;
}

export interface FingerprintCell {
  n: number;
  m: number;
  flag: 0 | 1;
}

export interface DisciplineFingerprint {
  races: number;        // 対象候補レース数
  racesUsed: number;    // ゲート通過（プール採用）レース数
  legsValid: number;    // プールした有効レッグ数（除染後）
  legsPack: number;     // パック除外レッグ数
  packUnchecked: number; // start 不明でパック未チェックのレース数
  missRate: number;     // プール全体のミス率
  /** 9固定: idx = 局面(0序/1中/2終)*3 + レッグ長(0短/1中/2長) */
  cells: FingerprintCell[];
  sev: [number, number, number]; // ミスの Δ 3ビン件数
  sevMedRho: number | null;      // ミスの ρ=loss/(lap−loss) 中央値
  /** 標本ゲート＋permutation p≤q 通過時のみ（RR = Mantel–Haenszel・層=レース）。未達は null */
  lag1: { n1: number; n0: number; rr: number } | null;
  /** 所属コホート帯 index（cohorts[disc].bands の添字）。Stage 2c 追加のためオプショナル */
  band?: number;
  /**
   * 直近期間 vs それ以前の**未調整の観測ミス率**（記述のみ・検定なし・Stage 2d）。
   * 両期間が表示ゲート（periodMinRaces/periodMinLegs）を満たすときだけ set される。
   * コース難度・季節・クラスを分離していないため上達/悪化の判定には使えない（表示側で明記）。
   */
  periods?: { recent: PeriodStat; older: PeriodStat };
}

/** 期間別の未調整観測値。races=採用レース数, n=有効レッグ数, m=ミスレッグ数 */
export interface PeriodStat {
  races: number;
  n: number;
  m: number;
}

export interface AthleteFingerprint {
  f?: DisciplineFingerprint;
  s?: DisciplineFingerprint;
  fr?: RaceWeight[]; // forest レース重み（指紋ゲートと独立に出す）
  sr?: RaceWeight[];
}

/** コホート帯（同水準巡航速度の掲載選手プール）。cells は [n, m] の9組 */
export interface CohortBand {
  athletes: number;
  legs: number;
  cells: [number, number][];
}

export interface CohortNorms {
  /** 帯境界（中央値巡航速度の分位点。速度は小さいほど速い） */
  cuts: number[];
  bands: CohortBand[];
}

export interface LegFingerprintIndex {
  v: 1;
  generatedAt: string | null;
  params: FingerprintParams;
  athletes: Record<string, AthleteFingerprint>;
  /** Stage 2c: 種目別コホート帯基準（記述比較用・検定なし） */
  cohorts?: { f?: CohortNorms; s?: CohortNorms };
  /** Stage 2c: 同姓同名（物理的重複）検出で集計除外した名前の数 */
  homonymExcluded?: number;
  /** Stage 2d: 期間比較の境界日（ISO・"recent" は event_date ≥ この日）。未指定なら期間比較なし */
  periodCutoff?: string;
}

/** "HH:MM:SS" / "HH:MM" → 秒。不正・空は null */
export function parseStartSec(s: string | null | undefined): number | null {
  if (s == null) return null;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + (m[3] ? Number(m[3]) : 0);
}

/**
 * クラブ表記の照合（matchTracked と同じ包含許容）。どちらかが空なら「相違」とは判定しない。
 * 別人判定はクラブ相違が確認できる場合のみに限定する（実データ検証 2026-07-07:
 * クラブ条件なしの物理矛盾検出は 732 名を誤検出＝ほぼ全てが練習会の再走・重複掲載だった）。
 */
function clubsDisjoint(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const as = a.split("/").map(norm).filter(Boolean);
  const bs = b.split("/").map(norm).filter(Boolean);
  if (as.length === 0 || bs.length === 0) return false;
  return !as.some((x) => bs.some((y) => x === y || x.includes(y) || y.includes(x)));
}

/**
 * 同姓同名（別人混在）の検出。氏名キーは維持しつつ、「物理的に1人ではありえない ＋
 * クラブ表記が相違する」記録を持つ名前を集計から除外するための純関数。検出条件:
 * (i) 同一大会・同一クラスに rank 付き・クラブ相違の行ペア（練習会の同クラス再走は同クラブ＝非該当）
 * (ii) 同日の別レースで走行時間帯 [start, start+finish] が overlapSec 以上重複し、かつクラブ相違。
 *      開始・終了がほぼ同時刻（±60s）のペアは同一走の重複掲載とみなし除外しない
 * リレー系クラスは判定から除外。クラブ欠落データの同姓同名は検出できない（docs に明記）。
 */
export function detectHomonymKeys(rows: TrackedLegRow[], overlapSec = DEFAULT_PARAMS.homonymOverlapSec): Set<string> {
  const DUP_PUBLISH_TOL = 60; // 同一走の重複掲載とみなす開始/終了時刻差
  const out = new Set<string>();
  const byKey = new Map<string, TrackedLegRow[]>();
  for (const r of rows) {
    if (RELAY_RE.test(`${r.event_name} ${r.class_name ?? ""}`)) continue;
    const list = byKey.get(r.runner_key) ?? [];
    list.push(r);
    byKey.set(r.runner_key, list);
  }
  for (const [key, list] of byKey) {
    let hit = false;
    // (i) 同一クラス内のクラブ相違ペア
    const byClass = new Map<string, TrackedLegRow[]>();
    for (const r of list) {
      if (r.rank == null) continue;
      const k = `${r.lc_event_id}:${r.lc_class_id}`;
      const arr = byClass.get(k) ?? [];
      arr.push(r);
      byClass.set(k, arr);
    }
    outer1: for (const arr of byClass.values()) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          if (clubsDisjoint(arr[i].club, arr[j].club)) {
            hit = true;
            break outer1;
          }
        }
      }
    }
    // (ii) 同日の時間重複＋クラブ相違（重複掲載は除く）
    if (!hit) {
      const byDate = new Map<string, { start: number; end: number; race: string; club: string | null }[]>();
      for (const r of list) {
        const start = parseStartSec(r.start_time);
        if (start == null) continue;
        let finish: number | null = null;
        for (let i = r.elapsed_sec.length - 1; i >= 0; i--) {
          if (r.elapsed_sec[i] != null) {
            finish = r.elapsed_sec[i];
            break;
          }
        }
        if (finish == null || finish <= 0) continue;
        const arr = byDate.get(r.event_date) ?? [];
        arr.push({ start, end: start + finish, race: `${r.lc_event_id}:${r.lc_class_id}`, club: r.club });
        byDate.set(r.event_date, arr);
      }
      outer2: for (const arr of byDate.values()) {
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            if (arr[i].race === arr[j].race) continue;
            if (!clubsDisjoint(arr[i].club, arr[j].club)) continue;
            if (
              Math.abs(arr[i].start - arr[j].start) <= DUP_PUBLISH_TOL &&
              Math.abs(arr[i].end - arr[j].end) <= DUP_PUBLISH_TOL
            ) {
              continue; // 同一走の重複掲載
            }
            const ov = Math.min(arr[i].end, arr[j].end) - Math.max(arr[i].start, arr[j].start);
            if (ov >= overlapSec) {
              hit = true;
              break outer2;
            }
          }
        }
      }
    }
    if (hit) out.add(key);
  }
  return out;
}

/** ミス判定: loss ≥ max(floor, ratio×(lap−loss))。lap−loss = 自分の巡航ペース想定タイム */
export function classifyMiss(lap: number, loss: number, floor: number, ratio: number): boolean {
  const baseline = lap - loss;
  if (baseline <= 0) return false; // 無効レッグは呼び出し側で除外済みだが防御
  return loss >= Math.max(floor, ratio * baseline);
}

/**
 * パック検出。myClock/othersClocks は境界時刻列（長さ = レッグ数+1・[0]=スタート）。
 * |Δ|≤eps が (minLegs+1) 境界以上連続する極大 run の内部レッグを true にする。
 * null 境界は run を分断。返り値はレッグ単位（長さ = レッグ数）。
 */
export function detectPackLegs(
  myClock: (number | null)[],
  othersClocks: (number | null)[][],
  eps: number,
  minLegs: number
): boolean[] {
  const nLegs = myClock.length - 1;
  const packed = new Array<boolean>(nLegs).fill(false);
  for (const other of othersClocks) {
    if (other.length !== myClock.length) continue;
    let runStart = -1;
    for (let k = 0; k <= myClock.length; k++) {
      const close =
        k < myClock.length &&
        myClock[k] != null &&
        other[k] != null &&
        Math.abs(myClock[k]! - other[k]!) <= eps;
      if (close) {
        if (runStart < 0) runStart = k;
      } else {
        if (runStart >= 0) {
          const runBoundaries = k - runStart;
          if (runBoundaries >= minLegs + 1) {
            for (let l = runStart; l < k - 1; l++) packed[l] = true;
          }
          runStart = -1;
        }
      }
    }
  }
  return packed;
}

/** 決定的な小型 PRNG（mulberry32）。artifact の再現性のため Math.random は使わない */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates（in-place・rng 指定） */
function shuffle<T>(xs: T[], rng: () => number): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
}

/** Benjamini–Hochberg。null は検定対象外（false）。返り値は同順の採択フラグ */
export function bhFdr(pvals: (number | null)[], q: number): boolean[] {
  const idx = pvals
    .map((p, i) => ({ p, i }))
    .filter((x): x is { p: number; i: number } => x.p != null)
    .sort((a, b) => a.p - b.p);
  const m = idx.length;
  const out = new Array<boolean>(pvals.length).fill(false);
  let cut = -1;
  for (let r = 0; r < m; r++) {
    if (idx[r].p <= ((r + 1) / m) * q) cut = r;
  }
  for (let r = 0; r <= cut; r++) out[idx[r].i] = true;
  return out;
}

/**
 * lag-1 動揺の Mantel–Haenszel 相対リスク（層=レース）。
 * 層 r: a=ミス→ミス, n1=ミス→（次レッグあり）, b=クリーン→ミス, n0=クリーン→（次レッグあり）。
 * RR = Σ(a·n0/n) / Σ(b·n1/n)。分母 0 は null。
 * 層別によりレース間の調子差（悪い日はミスもペアも多い）がプール比に化けるのを防ぐ。
 */
export function mhLag1(
  strata: { a: number; n1: number; b: number; n0: number }[]
): number | null {
  let num = 0;
  let den = 0;
  for (const s of strata) {
    const n = s.n1 + s.n0;
    if (n === 0) continue;
    num += (s.a * s.n0) / n;
    den += (s.b * s.n1) / n;
  }
  if (den <= 0) return null;
  return num / den;
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** FNV-1a（選手キー → permutation シードの決定的分岐用） */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface RacePool {
  date: string;
  cells: number[];    // プールレッグのセル idx（局面*3+レッグ長・コース順）
  miss: boolean[];    // プールレッグのミス（コース順）
  adjNext: boolean[]; // 次のコースレッグも連続してプールされているか（lag-1 ペア判定）
  losses: number[];   // ミスレッグの Δ（表示用）
  rhos: number[];     // ミスレッグの ρ
}

/** ミス列と隣接情報から lag-1 層（a=ミス→ミス, n1=ミス→次あり, b=クリーン→ミス, n0） */
function lagStratum(miss: boolean[], adjNext: boolean[]): { a: number; n1: number; b: number; n0: number } {
  const s = { a: 0, n1: 0, b: 0, n0: 0 };
  for (let i = 0; i < miss.length; i++) {
    if (!adjNext[i]) continue;
    if (miss[i]) {
      s.n1++;
      if (miss[i + 1]) s.a++;
    } else {
      s.n0++;
      if (miss[i + 1]) s.b++;
    }
  }
  return s;
}

/** lc_leg_splits の行群から指紋 index を構築する */
export function buildLegFingerprintIndex(
  tracked: TrackedLegRow[],
  companions: CompanionRow[],
  opts: Partial<FingerprintParams> & { periodCutoff?: string } = {}
): LegFingerprintIndex {
  const { periodCutoff, ...paramOverrides } = opts;
  const P: FingerprintParams = { ...DEFAULT_PARAMS, ...paramOverrides };

  // クラス → 境界時計列（tracked 行も companion を兼ねる）。identity は参照で除外する
  const classClocks = new Map<string, { ref: unknown; clock: (number | null)[] }[]>();
  const classSize = new Map<string, number>();
  const boundaryClock = (start: number | null, elapsed: (number | null)[]): (number | null)[] => {
    const out: (number | null)[] = [start];
    for (const e of elapsed) out.push(start != null && e != null ? start + e : null);
    return out;
  };
  const addClock = (key: string, ref: unknown, start: string | null, elapsed: (number | null)[]) => {
    const s = parseStartSec(start);
    const list = classClocks.get(key) ?? [];
    list.push({ ref, clock: boundaryClock(s, elapsed) });
    classClocks.set(key, list);
    classSize.set(key, (classSize.get(key) ?? 0) + 1);
  };
  for (const r of tracked) addClock(`${r.lc_event_id}:${r.lc_class_id}`, r, r.start_time, r.elapsed_sec);
  for (const c of companions) addClock(`${c.lc_event_id}:${c.lc_class_id}`, c, c.start_time, c.elapsed_sec);

  // 同姓同名（物理的重複）の検出 → 該当名は重み・指紋とも集計から除外
  const homonyms = detectHomonymKeys(tracked, P.homonymOverlapSec);

  // 選手×種目 → レースプール
  const pools = new Map<string, RacePool[]>(); // key = runner_key + "|" + f|s
  const weights = new Map<string, RaceWeight[]>();
  const meta = new Map<string, { races: number; legsPack: number; packUnchecked: number }>();
  const speedsByKey = new Map<string, number[]>(); // コホート帯用（レース巡航速度）

  for (const r of tracked) {
    if (r.rank == null || r.speed == null) continue;
    if (homonyms.has(r.runner_key)) continue;
    if (RELAY_RE.test(`${r.event_name} ${r.class_name ?? ""}`)) continue;
    const L = r.lap_sec.length;
    if (L < 3) continue;
    const disc = r.race_type === "sprint" ? "s" : "f";
    const key = `${r.runner_key}|${disc}`;
    const floor = P.floors[r.race_type];
    const eps = P.packEps[r.race_type];
    const classKey = `${r.lc_event_id}:${r.lc_class_id}`;

    const m = meta.get(key) ?? { races: 0, legsPack: 0, packUnchecked: 0 };
    m.races++;
    const spd = speedsByKey.get(key) ?? [];
    spd.push(r.speed);
    speedsByKey.set(key, spd);

    // 有効レッグ
    const valid = new Array<boolean>(L).fill(false);
    for (let l = 0; l < L; l++) {
      const lap = r.lap_sec[l];
      const loss = r.leg_loss_sec[l];
      const sp = r.leg_speed[l];
      if (lap == null || loss == null || sp == null) continue;
      if (lap <= 0 || lap - loss <= 0 || sp <= 0 || sp > 3000) continue;
      valid[l] = true;
    }

    // パック除染
    let packed = new Array<boolean>(L).fill(false);
    const myStart = parseStartSec(r.start_time);
    if (myStart == null) {
      m.packUnchecked++;
    } else {
      const myClock = boundaryClock(myStart, r.elapsed_sec);
      const others = (classClocks.get(classKey) ?? [])
        .filter((x) => x.ref !== r)
        .map((x) => x.clock);
      packed = detectPackLegs(myClock, others, eps, P.packMinLegs);
    }
    const packCount = packed.filter(Boolean).length;
    m.legsPack += packCount;

    // レッグ長ターシル（レース内・有効レッグの Ave3 分位）
    const ave3: (number | null)[] = r.lap_sec.map((lap, l) =>
      lap != null && r.leg_speed[l] != null && r.leg_speed[l]! > 0 ? (100 * lap) / r.leg_speed[l]! : null
    );
    const validAve3 = ave3.filter((v, l) => v != null && valid[l]) as number[];
    const sortedAve3 = [...validAve3].sort((a, b) => a - b);
    const q1 = sortedAve3[Math.floor(sortedAve3.length / 3)] ?? Infinity;
    const q2 = sortedAve3[Math.floor((2 * sortedAve3.length) / 3)] ?? Infinity;
    const lenIdx = (v: number): number => (v < q1 ? 0 : v < q2 ? 1 : 2);

    // プール（valid かつ非パック・コース順）
    const pool: RacePool = {
      date: r.event_date,
      cells: [],
      miss: [],
      adjNext: [],
      losses: [],
      rhos: [],
    };
    let cleanLegs = 0;
    let prevPooledLeg = -2;
    for (let l = 0; l < L; l++) {
      if (!valid[l] || packed[l]) continue;
      const lap = r.lap_sec[l]!;
      const loss = r.leg_loss_sec[l]!;
      const isMiss = classifyMiss(lap, loss, floor, P.missRatio);
      if (!isMiss) cleanLegs++;
      const phase = Math.min(2, Math.floor((3 * l) / L));
      const len = ave3[l] != null ? lenIdx(ave3[l]!) : 1;
      // 直前のプールレッグがコース上で連続していれば、そのエントリの adjNext を立てる
      if (prevPooledLeg === l - 1 && pool.adjNext.length > 0) {
        pool.adjNext[pool.adjNext.length - 1] = true;
      }
      pool.cells.push(phase * 3 + len);
      pool.miss.push(isMiss);
      pool.adjNext.push(false);
      prevPooledLeg = l;
      if (isMiss) {
        pool.losses.push(loss);
        pool.rhos.push(loss / (lap - loss));
      }
    }

    // レース重み（指紋ゲートと独立・fieldN=クラス収録行数）
    const fieldN = classSize.get(classKey) ?? 1;
    const w = cleanLegs * Math.min(fieldN, P.fieldNCap);
    const reliable: 0 | 1 = cleanLegs >= P.raceCleanGate && fieldN >= 5 ? 1 : 0;
    const wl = weights.get(key) ?? [];
    wl.push({ d: r.event_date, w, r: reliable });
    weights.set(key, wl);

    // レースゲート: パック過半 or 除染後クリーン < gate はプール不採用
    if (packCount > P.packMaxShare * L || cleanLegs < P.raceCleanGate || pool.miss.length === 0) {
      meta.set(key, m);
      continue;
    }
    const list = pools.get(key) ?? [];
    list.push(pool);
    pools.set(key, list);
    meta.set(key, m);
  }

  // 集計
  const athletes: Record<string, AthleteFingerprint> = {};
  const ensure = (name: string): AthleteFingerprint => (athletes[name] ??= {});

  for (const [key, wl] of weights) {
    const [name, disc] = key.split("|");
    const sorted = [...wl].sort((a, b) => a.d.localeCompare(b.d));
    if (disc === "f") ensure(name).fr = sorted;
    else ensure(name).sr = sorted;
  }

  const gatedList: { disc: string; fp: DisciplineFingerprint; med: number }[] = [];

  for (const [key, races] of pools) {
    const [name, disc] = key.split("|");
    const m = meta.get(key)!;
    const legsValid = races.reduce((s, r) => s + r.miss.length, 0);
    if (races.length < P.minRaces || legsValid < P.minLegs) continue;

    const cells: { n: number; m: number }[] = Array.from({ length: 9 }, () => ({ n: 0, m: 0 }));
    let missTotal = 0;
    const losses: number[] = [];
    const rhos: number[] = [];
    const strata: { a: number; n1: number; b: number; n0: number }[] = [];
    for (const race of races) {
      for (let i = 0; i < race.miss.length; i++) {
        cells[race.cells[i]].n++;
        if (race.miss[i]) {
          cells[race.cells[i]].m++;
          missTotal++;
        }
      }
      losses.push(...race.losses);
      rhos.push(...race.rhos);
      strata.push(lagStratum(race.miss, race.adjNext));
    }
    const rrObs = mhLag1(strata);

    // セル検定: レース層別 permutation（各レースのミス総数を固定してレッグへの割当を並べ替え）。
    // 日次調子・レース内相関を帰無分布に保存する（exact 二項は独立性仮定が壊れ甘くなるため不採用）。
    // 片側（ミス率が高い側）。lag-1 RR も同じ並べ替えで帰無分布を得る（コース系列構造は保存）。
    const rng = mulberry32((P.permSeed ^ hashString(key)) >>> 0);
    const exceedCell = new Array<number>(9).fill(0);
    let exceedLag = 0;
    let lagValidPerms = 0;
    for (let b = 0; b < P.permB; b++) {
      const permCellMiss = new Array<number>(9).fill(0);
      const permStrata: { a: number; n1: number; b: number; n0: number }[] = [];
      for (const race of races) {
        const flags = [...race.miss];
        shuffle(flags, rng);
        for (let i = 0; i < flags.length; i++) {
          if (flags[i]) permCellMiss[race.cells[i]]++;
        }
        permStrata.push(lagStratum(flags, race.adjNext));
      }
      for (let c = 0; c < 9; c++) {
        if (permCellMiss[c] >= cells[c].m) exceedCell[c]++;
      }
      if (rrObs != null) {
        const rrPerm = mhLag1(permStrata);
        if (rrPerm != null) {
          lagValidPerms++;
          if (rrPerm >= rrObs) exceedLag++;
        }
      }
    }
    const pvals: (number | null)[] = cells.map((c, i) => {
      if (c.n < P.cellMinN) return null;
      return (1 + exceedCell[i]) / (P.permB + 1);
    });
    const bhPass = bhFdr(pvals, P.fdrQ);
    // 効果量ゲート: 統計的に通っても自己基準率（leave-one-cell-out）比が小さいセルはフラグしない
    const flags = cells.map((c, i) => {
      if (!bhPass[i] || c.n === 0) return false;
      const restN = legsValid - c.n;
      const restM = missTotal - c.m;
      if (restN <= 0 || restM <= 0) return false;
      return c.m / c.n >= P.cellMinRatio * (restM / restN);
    });
    const lagP = rrObs != null && lagValidPerms > 0 ? (1 + exceedLag) / (lagValidPerms + 1) : null;

    // 重大度
    const disciplineKey = disc === "f" ? "forest" : "sprint";
    const [b1, b2] = P.sevBins[disciplineKey as "forest" | "sprint"];
    const sev: [number, number, number] = [0, 0, 0];
    for (const d of losses) {
      if (d < b1) sev[0]++;
      else if (d < b2) sev[1]++;
      else sev[2]++;
    }
    const sortedRho = [...rhos].sort((a, b) => a - b);
    const sevMedRho = sortedRho.length
      ? round3(sortedRho[Math.floor(sortedRho.length / 2)])
      : null;

    // lag-1: 標本ゲート＋permutation p ≤ fdrQ を通過したときのみ出す（単一検定・BH なし）
    const n1 = strata.reduce((s, x) => s + x.n1, 0);
    const n0 = strata.reduce((s, x) => s + x.n0, 0);
    const lag1 =
      n1 >= P.lag1MinN1 && n0 >= P.lag1MinN0 && rrObs != null && lagP != null && lagP <= P.fdrQ
        ? { n1, n0, rr: round3(rrObs) }
        : null;

    // 期間比較（Stage 2d・未調整の観測値・検定なし）: 採用レースを cutoff で二分し、
    // 両期間が表示ゲート（periodMinRaces/periodMinLegs）を満たすときだけ全体ミス率を出す。
    // セル別には割らない（薄い n で「どのセルが直った」と誤読させないため・Codex レビュー反映）。
    let periods: { recent: PeriodStat; older: PeriodStat } | undefined;
    if (periodCutoff) {
      const stat = (pred: (d: string) => boolean): PeriodStat => {
        let races2 = 0;
        let n = 0;
        let mm = 0;
        for (const race of races) {
          if (!pred(race.date)) continue;
          races2++;
          n += race.miss.length;
          mm += race.miss.filter(Boolean).length;
        }
        return { races: races2, n, m: mm };
      };
      const recent = stat((d) => d >= periodCutoff);
      const older = stat((d) => d < periodCutoff);
      const ok = (s: PeriodStat) => s.races >= P.periodMinRaces && s.n >= P.periodMinLegs;
      if (ok(recent) && ok(older)) periods = { recent, older };
    }

    const fp: DisciplineFingerprint = {
      races: m.races,
      racesUsed: races.length,
      legsValid,
      legsPack: m.legsPack,
      packUnchecked: m.packUnchecked,
      missRate: round3(missTotal / legsValid),
      cells: cells.map((c, i) => ({ n: c.n, m: c.m, flag: flags[i] ? 1 : 0 })),
      sev,
      sevMedRho,
      lag1,
      ...(periods ? { periods } : {}),
    };
    if (disc === "f") ensure(name).f = fp;
    else ensure(name).s = fp;
    const spds = speedsByKey.get(key);
    if (spds && spds.length > 0) {
      const s = [...spds].sort((a, b) => a - b);
      gatedList.push({ disc, fp, med: s[Math.floor(s.length / 2)] });
    }
  }

  // コホート帯（Stage 2c・記述比較用）: ゲート通過選手を中央値巡航速度の分位で帯分け。
  // 巡航速度は出走クラスのトップ(Ave3)基準の相対値であり絶対走力ではない（表示側で明記）。
  // 循環性は実測で否定済み（レース内 speed×ミス率の相関 ≈ 0）。
  const cohorts: { f?: CohortNorms; s?: CohortNorms } = {};
  for (const disc of ["f", "s"] as const) {
    const list = gatedList.filter((g) => g.disc === disc);
    const k = disc === "f" ? P.cohortBands.forest : P.cohortBands.sprint;
    if (k < 2 || list.length < k * 10) continue; // 帯あたり最低10人を確保できなければ出さない
    const meds = list.map((g) => g.med).sort((a, b) => a - b);
    const cuts: number[] = [];
    for (let i = 1; i < k; i++) cuts.push(meds[Math.floor((i * meds.length) / k)]);
    const bands: CohortBand[] = Array.from({ length: k }, () => ({
      athletes: 0,
      legs: 0,
      cells: Array.from({ length: 9 }, () => [0, 0] as [number, number]),
    }));
    for (const g of list) {
      let b = 0;
      for (const c of cuts) if (g.med >= c) b++;
      const band = bands[Math.min(b, k - 1)];
      g.fp.band = Math.min(b, k - 1);
      band.athletes++;
      band.legs += g.fp.legsValid;
      g.fp.cells.forEach((c, i) => {
        band.cells[i][0] += c.n;
        band.cells[i][1] += c.m;
      });
    }
    cohorts[disc] = { cuts, bands };
  }

  return {
    v: 1,
    generatedAt: null,
    params: P,
    athletes,
    cohorts,
    homonymExcluded: homonyms.size,
    ...(periodCutoff ? { periodCutoff } : {}),
  };
}
