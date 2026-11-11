/**
 * 配車 UI が参照する DTO 型の再エクスポートと、UI 固有の補助型。
 * DTO の正本は @/lib/carpool/api/mappers（API 契約）に置く。
 */

import type { DetectedEntry as DetectedEntryBase } from "@/lib/carpool/entry-detect";

export type {
  ClubDTO,
  NodeDTO,
  PickupPrefDTO,
  MemberDTO,
  EventDTO,
  ParticipationDTO,
  TravelTimeDTO,
  RouteDTO,
  RouteTimeDTO,
} from "@/lib/carpool/api/mappers";

/**
 * detect-entries の検出行。正本は @/lib/carpool/entry-detect の DetectedEntry。
 * `rawName`（生氏名・表示用）はバックエンドが追加予定の先行定義（任意）。
 * 表示は `rawName ?? nameKey` のフォールバックで行う。
 */
export type DetectedEntry = DetectedEntryBase & { rawName?: string };

/** events-search の結果行（JOY 由来の大会候補）。 */
export interface JoyEvent {
  joeEventId: number;
  name: string;
  date: string;
  venue: string | null;
  prefecture?: string;
  lat: number | null;
  lng: number | null;
  joeUrl?: string;
  bulletinUrl?: string;
}

/** athletes/search の結果行（選手キー候補）。 */
export interface AthleteSuggestion {
  name: string;
  clubs: string[];
}
