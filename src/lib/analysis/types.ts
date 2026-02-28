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

/** 完全なランキング出現情報 (詳細ロード時) */
export interface RankingAppearance extends RankingRef {
  events: EventScore[];
}

/** 軽量インデックスの選手プロフィール (検索・一覧用) */
export interface AthleteSummary {
  name: string;
  clubs: string[];
  appearances: RankingRef[]; // どのカテゴリに登場するか
  bestRank: number;
  bestPoints: number;
  forestCount: number;
  sprintCount: number;
  type: "sprinter" | "forester" | "allrounder" | "unknown";
}

/** 詳細プロフィール (個別ロード用) */
export interface AthleteProfile extends AthleteSummary {
  rankings: RankingAppearance[];
}

export interface ClubMember {
  name: string;
  bestRank: number;
  bestPoints: number;
  rankingType: string; // "age_forest" etc. (best ranking's type)
  className: string;
  athleteType: "sprinter" | "forester" | "allrounder" | "unknown";
  isActive: boolean;
  categoryCount: number;
  recentForm: number; // % (直近3大会 vs 全体平均)
  consistency: number; // 0-100
  eventCount: number; // 大会数
}

export interface ClubProfile {
  name: string;
  memberCount: number;
  activeCount: number;
  avgPoints: number;
  members: ClubMember[]; // 全メンバー (rank順)
  forestCount: number;
  sprintCount: number;
}

export interface AthleteIndex {
  athletes: Record<string, AthleteSummary>;
  generatedAt: string;
}

export interface ClubIndex {
  clubs: Record<string, ClubProfile>;
  generatedAt: string;
}
