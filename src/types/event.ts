export type EventType = "official" | "local" | "training" | "trail_run";
export type EventStatus = "upcoming" | "ongoing" | "completed";
export type ResultStatus = "ok" | "dnf" | "dns" | "mp";

export interface Event {
  id: string;
  name: string;
  date: string;
  end_date?: string;
  event_type: EventType;
  location: {
    prefecture: string;
    city: string;
    venue: string;
    lat: number;
    lng: number;
  };
  organizer: string;
  map_id?: string;
  entry_url?: string;
  results_url?: string;
  description?: string;
  classes: EventClass[];
  status: EventStatus;
}

export interface EventClass {
  name: string;
  distance_km?: number;
  climb_m?: number;
  controls?: number;
}

export interface EventResult {
  event_id: string;
  class_name: string;
  results: ResultEntry[];
}

export interface ResultEntry {
  rank: number;
  name: string;
  club: string;
  time: string;
  status: ResultStatus;
  splits?: SplitTime[];
}

export interface SplitTime {
  control: number;
  time: string;
  leg_time: string;
  rank: number;
}
