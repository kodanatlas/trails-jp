/**
 * DB 行（snake_case）→ API レスポンス形（camelCase）の変換を集約する。
 * capacity ⇔ seatsAvailable 変換もここを通す（schemas.ts の capacityToSeats を使用）。
 *
 * UI エージェントはここの戻り値型を API 契約として参照する。
 */

import { capacityToSeats } from "./schemas";

// ---------------------------------------------------------------------------
// API レスポンス型（UI 契約）
// ---------------------------------------------------------------------------

export interface ClubDTO {
  id: string;
  name: string;
  slug: string;
  joeClubNames: string[];
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface NodeDTO {
  id: string;
  clubId: string;
  kind: "area" | "pickup" | "venue";
  name: string;
  lat: number | null;
  lng: number | null;
  parking: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PickupPrefDTO {
  nodeId: string;
  strength: "hard" | "soft";
}

export interface MemberDTO {
  id: string;
  clubId: string;
  displayName: string;
  athleteKey: string | null;
  homeNodeId: string | null;
  hasCar: boolean;
  /** 同乗可能人数（自分以外）。DB capacity から −1。 */
  seatsAvailable: number | null;
  defaultWillingness: "always" | "if_needed";
  earliestDeparture: string | null;
  luggageInCar: boolean;
  active: boolean;
  pickupPrefs?: PickupPrefDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface TravelTimeDTO {
  fromNodeId: string;
  toNodeId: string;
  mode: "car" | "transit";
  minutes: number;
  source: "manual" | "osrm" | "api";
  updatedAt: string;
}

export interface EventDTO {
  id: string;
  clubId: string;
  joeEventId: number | null;
  name: string;
  eventDate: string;
  venueNodeId: string | null;
  bufferMin: number;
  status: "planning" | "provisional" | "final" | "closed";
  bulletinUrl: string | null;
  startlistUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RouteTimeDTO {
  nodeId: string;
  minutesToVenue: number;
}

export interface RouteDTO {
  id: string;
  eventId: string;
  name: string;
  tollYen: number;
  distanceKm: number;
  riskScore: number;
  riskWindows: unknown[];
  routeTimes?: RouteTimeDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface ParticipationDTO {
  id: string;
  eventId: string;
  memberId: string;
  role: "driver" | "rider" | "self" | "absent";
  /** 同乗可能人数（自分以外）。DB capacity_override から −1。 */
  capacityOverrideSeats: number | null;
  willingness: "always" | "if_needed" | null;
  earliestDepartureOverride: string | null;
  fixedDriverMemberId: string | null;
  pickupPrefsOverride: unknown | null;
  startTime: string | null;
  className: string | null;
  estCourseMin: number | null;
  entrySource: "auto" | "manual";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 行 → DTO 変換
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

export function toClubDTO(r: any): ClubDTO {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    joeClubNames: r.joe_club_names ?? [],
    settings: r.settings ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toNodeDTO(r: any): NodeDTO {
  return {
    id: r.id,
    clubId: r.club_id,
    kind: r.kind,
    name: r.name,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    parking: !!r.parking,
    note: r.note ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toMemberDTO(r: any, pickupPrefs?: PickupPrefDTO[]): MemberDTO {
  return {
    id: r.id,
    clubId: r.club_id,
    displayName: r.display_name,
    athleteKey: r.athlete_key ?? null,
    homeNodeId: r.home_node_id ?? null,
    hasCar: !!r.has_car,
    seatsAvailable: capacityToSeats(r.default_capacity),
    defaultWillingness: r.default_willingness,
    earliestDeparture: r.earliest_departure ?? null,
    luggageInCar: !!r.luggage_in_car,
    active: !!r.active,
    ...(pickupPrefs ? { pickupPrefs } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toTravelTimeDTO(r: any): TravelTimeDTO {
  return {
    fromNodeId: r.from_node_id,
    toNodeId: r.to_node_id,
    mode: r.mode,
    minutes: r.minutes,
    source: r.source,
    updatedAt: r.updated_at,
  };
}

export function toEventDTO(r: any): EventDTO {
  return {
    id: r.id,
    clubId: r.club_id,
    joeEventId: r.joe_event_id ?? null,
    name: r.name,
    eventDate: r.event_date,
    venueNodeId: r.venue_node_id ?? null,
    bufferMin: r.buffer_min,
    status: r.status,
    bulletinUrl: r.bulletin_url ?? null,
    startlistUrl: r.startlist_url ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toRouteTimeDTO(r: any): RouteTimeDTO {
  return { nodeId: r.node_id, minutesToVenue: r.minutes_to_venue };
}

export function toRouteDTO(r: any, routeTimes?: RouteTimeDTO[]): RouteDTO {
  return {
    id: r.id,
    eventId: r.event_id,
    name: r.name,
    tollYen: r.toll_yen,
    distanceKm: Number(r.distance_km),
    riskScore: r.risk_score,
    riskWindows: r.risk_windows ?? [],
    ...(routeTimes ? { routeTimes } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toParticipationDTO(r: any): ParticipationDTO {
  return {
    id: r.id,
    eventId: r.event_id,
    memberId: r.member_id,
    role: r.role,
    capacityOverrideSeats: capacityToSeats(r.capacity_override),
    willingness: r.willingness ?? null,
    earliestDepartureOverride: r.earliest_departure_override ?? null,
    fixedDriverMemberId: r.fixed_driver_member_id ?? null,
    pickupPrefsOverride: r.pickup_prefs_override ?? null,
    startTime: r.start_time ?? null,
    className: r.class_name ?? null,
    estCourseMin: r.est_course_min ?? null,
    entrySource: r.entry_source,
    notes: r.notes ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
