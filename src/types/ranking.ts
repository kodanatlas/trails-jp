export interface Ranking {
  year: number;
  class_name: string;
  entries: RankingEntry[];
}

export interface RankingEntry {
  rank: number;
  athlete_name: string;
  club: string;
  points: number;
  events_counted: number;
  best_results: {
    event_name: string;
    date: string;
    rank: number;
    points: number;
  }[];
}
