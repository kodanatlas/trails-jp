/** 前計算インデックスの型定義 */

export interface EventScore {
  date: string; // "YYYY-MM-DD"
  eventName: string;
  points: number;
}

export interface RankingRef {
  type: string; // "age_forest", "elite_sprint", etc.
  className: string; // "M21", "S_Open", etc.
  rank: number;
  totalPoints: number;
  isActive: boolean;
}

/** 順位・得点の変動（先週比 wow / 前月比 mom / 前年比 yoy）。対応スナップショットがある選手のみ付く */
export interface RankDelta {
  mom: number | null;
  yoy: number | null;
  wow?: number | null;
}

/** 完全なランキング出現情報 (詳細ロード時) */
export interface RankingAppearance extends RankingRef {
  events: EventScore[];
  rankDelta?: RankDelta; // 順位変動（正=前月より上昇）
  pointsDelta?: RankDelta; // 得点変動
}

/** 軽量インデックスの選手プロフィール (検索・一覧用) */
export interface AthleteSummary {
  name: string;
  clubs: string[];
  appearances: RankingRef[]; // どのカテゴリに登場するか
  bestRank: number;
  avgTotalPoints: number;
  forestCount: number;
  sprintCount: number;
  type: "sprinter" | "forester" | "allrounder" | "unknown";
  recentForm: number; // 直近3大会 vs 全体平均 (%), 種目別算出
  raceCount?: number; // 重複排除済みの出場大会数（種目合算）。旧インデックスには無い
}

/** 詳細プロフィール (個別ロード用) */
export interface AthleteProfile extends AthleteSummary {
  rankings: RankingAppearance[];
}

export interface ClubMember {
  name: string;
  bestRank: number;
  avgTotalPoints: number;
  rankingType: string; // "age_forest" etc. (best ranking's type)
  className: string;
  athleteType: "sprinter" | "forester" | "allrounder" | "unknown";
  isActive: boolean;
  categoryCount: number;
  recentForm: number; // % (直近3大会 vs 全体平均)
  consistency: number; // 0-100
  eventCount: number; // 大会数
}

export interface ClubDelta {
  mom: number | null; // 前月比
  yoy: number | null; // 前年比
}

export interface ClubProfile {
  name: string;
  memberCount: number;
  activeCount: number;
  avgPoints: number;
  members: ClubMember[]; // 全メンバー (rank順)
  forestCount: number;
  sprintCount: number;
  delta?: {
    memberCount: ClubDelta;
    activeCount: ClubDelta;
    avgPoints: ClubDelta;
  };
}

/** LapCenter パフォーマンスデータ (巡航速度・ミス率) */
export interface LapCenterPerformance {
  d: string;         // date "YYYY-MM-DD"
  e: string;         // event name
  c: string;         // class name (MA, WA, etc.)
  s: number;         // cruising speed (%)
  m: number;         // miss rate (%)
  t: "forest" | "sprint";
  r?: number | null; // 出走クラスでの順位（lc_leg_splits 由来・per-leg 取込のあるクラスのみ）
}

export interface LapCenterIndex {
  athletes: Record<string, LapCenterPerformance[]>;
  generatedAt: string;
}

export interface AthleteIndex {
  athletes: Record<string, AthleteSummary>;
  generatedAt: string;
}

export interface ClubIndex {
  clubs: Record<string, ClubProfile>;
  generatedAt: string;
}
