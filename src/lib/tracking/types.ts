export interface TrackPoint {
  lat: number;
  lng: number;
  time: number; // seconds from participant start
  elevation?: number;
}

export interface TrackingParticipant {
  id: string;
  name: string;
  club: string;
  color: string;
  className: string;
  startTime: number; // seconds from event start
  raceTime: number;  // total race time in seconds
  track: TrackPoint[];
}

export interface ControlPoint {
  id: string;
  lat: number;
  lng: number;
}

export interface SplitEntry {
  participantId: string;
  controlId: string;
  time: number;   // cumulative time from start in seconds
  leg: number;     // leg time in seconds
  place: number;
}

export interface TrackingEvent {
  id: string;
  title: string;
  date: string;
  location: string;
  status: "live" | "archived";
  center: [number, number]; // [lat, lng]
  zoom: number;
  controls: ControlPoint[];
  courseOrder: string[]; // ordered control IDs
  participants: TrackingParticipant[];
  splits: SplitEntry[];
}
