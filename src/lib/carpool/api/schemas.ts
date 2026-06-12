/**
 * 配車割 API の zod スキーマ（API 契約の正本）。
 *
 * 重要な変換規約（02 §2 確定事項）:
 *   - DB の capacity 系列（members.default_capacity / participations.capacity_override）は
 *     「運転手を含む定員」を保存する。
 *   - API の入出力は「同乗可能人数（自分以外）」= seatsAvailable とする。
 *   - 保存時 +1、読み出し時 −1 の変換は本ファイルの seatsToCapacity / capacityToSeats に集約する。
 *   - null（未設定）は null のまま素通しする。
 *
 * 全 write スキーマは actorName（1〜30文字）を必須にする。
 */

import { z } from "zod";
import {
  ACTOR_NAME_MIN,
  ACTOR_NAME_MAX,
  TRAVEL_TIMES_BATCH_LIMIT,
  PICKUP_PREFS_MAX,
  ROUTE_TIMES_MAX,
  RISK_WINDOWS_MAX,
  MINUTES_MAX,
  TOLL_YEN_MAX,
  EST_COURSE_MIN_MAX,
  PARTICIPATION_BULK_LIMIT,
} from "./constants";

// ---------------------------------------------------------------------------
// 定員変換（seatsAvailable ⇔ DB capacity）
// ---------------------------------------------------------------------------

/** API の seatsAvailable（同乗可能人数, 自分以外）→ DB capacity（運転手含む定員）。null は null。 */
export function seatsToCapacity(seats: number | null | undefined): number | null {
  if (seats === null || seats === undefined) return null;
  return seats + 1;
}

/** DB capacity（運転手含む定員）→ API seatsAvailable（同乗可能人数, 自分以外）。null は null。0 未満は 0 で下げ止め。 */
export function capacityToSeats(capacity: number | null | undefined): number | null {
  if (capacity === null || capacity === undefined) return null;
  return Math.max(0, capacity - 1);
}

// ---------------------------------------------------------------------------
// 共通プリミティブ
// ---------------------------------------------------------------------------

/** 全 write リクエスト共通: 操作者名（自己申告・検証なし）。 */
export const actorName = z
  .string()
  .trim()
  .min(ACTOR_NAME_MIN, { message: "操作者名を入力してください" })
  .max(ACTOR_NAME_MAX, { message: `操作者名は${ACTOR_NAME_MAX}文字以内で入力してください` });

const actorEnvelope = { actorName };

/** "HH:MM" 形式の時刻文字列（null 許容は呼び出し側で .nullable()）。 */
export const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "時刻は HH:MM 形式で入力してください" });

/** "YYYY-MM-DD" 形式の日付文字列（実在日付チェック付き: 2026-02-31 等は 400）。 */
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "日付は YYYY-MM-DD 形式で入力してください" })
  .refine(
    (s) => {
      const [y, m, d] = s.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return (
        dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
      );
    },
    { message: "実在しない日付です" },
  );

const seatsAvailable = z
  .number()
  .int()
  .min(0, { message: "同乗可能人数は0以上で入力してください" })
  .max(20, { message: "同乗可能人数が大きすぎます" });

// ---------------------------------------------------------------------------
// clubs
// ---------------------------------------------------------------------------

/** クラブ設定。既知キーのみ受け付け（未知キーは除去）、数値域を制限する。 */
const clubSettings = z.object({
  fuel_price_per_liter: z.number().positive().max(1000).optional(),
  fuel_efficiency_km_per_liter: z.number().positive().max(50).optional(),
  driver_coefficient: z.union([z.literal(0), z.literal(0.5), z.literal(1)]).optional(),
  default_buffer_min: z.number().int().nonnegative().max(600).optional(),
  rounding_unit_yen: z.number().int().positive().max(10000).optional(),
});

export const clubCreateSchema = z.object({
  ...actorEnvelope,
  name: z.string().trim().min(1, { message: "クラブ名を入力してください" }).max(60),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]*$/, {
      message: "slug は英小文字・数字・ハイフンで入力してください",
    })
    .min(2)
    .max(40),
  joeClubNames: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  settings: clubSettings.optional(),
});

export const clubUpdateSchema = z.object({
  ...actorEnvelope,
  name: z.string().trim().min(1).max(60).optional(),
  joeClubNames: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  settings: clubSettings.optional(),
});

// ---------------------------------------------------------------------------
// nodes
// ---------------------------------------------------------------------------

export const nodeKind = z.enum(["area", "pickup", "venue"]);

export const nodeCreateSchema = z.object({
  ...actorEnvelope,
  kind: nodeKind,
  name: z.string().trim().min(1, { message: "ノード名を入力してください" }).max(80),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  parking: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
});

export const nodeUpdateSchema = z.object({
  ...actorEnvelope,
  kind: nodeKind.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  parking: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
});

// ---------------------------------------------------------------------------
// members（pickup prefs はメンバー更新内で置換）
// ---------------------------------------------------------------------------

const pickupPref = z.object({
  nodeId: z.string().uuid(),
  strength: z.enum(["hard", "soft"]),
});

const pickupPrefList = z.array(pickupPref).max(PICKUP_PREFS_MAX, {
  message: `ピックアップ希望は${PICKUP_PREFS_MAX}件までです`,
});

export const memberCreateSchema = z.object({
  ...actorEnvelope,
  displayName: z.string().trim().min(1, { message: "表示名を入力してください" }).max(40),
  athleteKey: z.string().trim().min(1).max(120).nullable().optional(),
  homeNodeId: z.string().uuid().nullable().optional(),
  /**
   * 自宅エリアをテキストで指定（ノード概念を UI から隠すための糖衣）。
   * homeNodeId 未指定時のみ有効: 同 club・kind='area'・name 一致のノードを再利用、無ければ作成して home_node_id に使う。
   */
  homeAreaName: z.string().trim().min(1).max(80).optional(),
  hasCar: z.boolean().optional(),
  /** API は seatsAvailable（同乗可能人数, 自分以外）で受ける。保存時 +1。 */
  seatsAvailable: seatsAvailable.nullable().optional(),
  defaultWillingness: z.enum(["always", "if_needed"]).optional(),
  earliestDeparture: timeString.nullable().optional(),
  luggageInCar: z.boolean().optional(),
  pickupPrefs: pickupPrefList.optional(),
});

export const memberUpdateSchema = z.object({
  ...actorEnvelope,
  displayName: z.string().trim().min(1).max(40).optional(),
  athleteKey: z.string().trim().min(1).max(120).nullable().optional(),
  homeNodeId: z.string().uuid().nullable().optional(),
  hasCar: z.boolean().optional(),
  seatsAvailable: seatsAvailable.nullable().optional(),
  defaultWillingness: z.enum(["always", "if_needed"]).optional(),
  earliestDeparture: timeString.nullable().optional(),
  luggageInCar: z.boolean().optional(),
  active: z.boolean().optional(),
  /** 指定時は driver_pickup_prefs を全置換。未指定なら据え置き。 */
  pickupPrefs: pickupPrefList.optional(),
});

// ---------------------------------------------------------------------------
// travel_times（バッチ upsert）
// ---------------------------------------------------------------------------

const travelTimeEntry = z.object({
  fromNodeId: z.string().uuid(),
  toNodeId: z.string().uuid(),
  mode: z.enum(["car", "transit"]),
  minutes: z.number().int().nonnegative().max(MINUTES_MAX, {
    message: `所要分は${MINUTES_MAX}分以内で入力してください`,
  }),
  source: z.enum(["manual", "osrm", "api"]).optional(),
});

export const travelTimesPutSchema = z.object({
  ...actorEnvelope,
  entries: z
    .array(travelTimeEntry)
    .min(1, { message: "更新する移動時間がありません" })
    .max(TRAVEL_TIMES_BATCH_LIMIT, {
      message: `移動時間は1リクエストにつき${TRAVEL_TIMES_BATCH_LIMIT}件までです`,
    }),
});

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

export const eventCreateSchema = z.object({
  ...actorEnvelope,
  /** trails.jp 大会 ID。指定時は events-store から名称・日付・venue を自動補完。 */
  joeEventId: z.number().int().positive().nullable().optional(),
  /** joeEventId 不在時（手動作成）に必須。 */
  name: z.string().trim().min(1).max(120).optional(),
  eventDate: dateString.optional(),
  bufferMin: z.number().int().nonnegative().max(600).optional(),
  bulletinUrl: z.string().url().nullable().optional(),
  startlistUrl: z.string().url().nullable().optional(),
});

export const eventUpdateSchema = z.object({
  ...actorEnvelope,
  name: z.string().trim().min(1).max(120).optional(),
  eventDate: dateString.optional(),
  status: z.enum(["planning", "provisional", "final", "closed"]).optional(),
  bufferMin: z.number().int().nonnegative().max(600).optional(),
  venueNodeId: z.string().uuid().nullable().optional(),
  bulletinUrl: z.string().url().nullable().optional(),
  startlistUrl: z.string().url().nullable().optional(),
});

// ---------------------------------------------------------------------------
// routes（route + route_times を一括）
// ---------------------------------------------------------------------------

const riskWindow = z.object({
  segment: z.string().max(60),
  direction: z.string().max(20).optional(),
  start: z.string().max(10).optional(),
  end: z.string().max(10).optional(),
  typical_delay_min: z.number().int().nonnegative().max(MINUTES_MAX).optional(),
});

const riskWindowList = z.array(riskWindow).max(RISK_WINDOWS_MAX, {
  message: `渋滞注意時間帯は${RISK_WINDOWS_MAX}件までです`,
});

const routeTimeEntry = z.object({
  nodeId: z.string().uuid(),
  minutesToVenue: z.number().int().nonnegative().max(MINUTES_MAX, {
    message: `会場までの所要分は${MINUTES_MAX}分以内で入力してください`,
  }),
});

const routeTimeList = z.array(routeTimeEntry).max(ROUTE_TIMES_MAX, {
  message: `所要時間は1ルートにつき${ROUTE_TIMES_MAX}件までです`,
});

const tollYen = z.number().int().nonnegative().max(TOLL_YEN_MAX, {
  message: `高速料金は${TOLL_YEN_MAX}円以内で入力してください`,
});

export const routeCreateSchema = z.object({
  ...actorEnvelope,
  name: z.string().trim().min(1).max(60),
  tollYen: tollYen.optional(),
  distanceKm: z.number().nonnegative().max(2000).optional(),
  riskScore: z.number().int().min(0).max(3).optional(),
  riskWindows: riskWindowList.optional(),
  routeTimes: routeTimeList.optional(),
});

export const routeUpdateSchema = z.object({
  ...actorEnvelope,
  routeId: z.string().uuid(),
  name: z.string().trim().min(1).max(60).optional(),
  tollYen: tollYen.optional(),
  distanceKm: z.number().nonnegative().max(2000).optional(),
  riskScore: z.number().int().min(0).max(3).optional(),
  riskWindows: riskWindowList.optional(),
  /** 指定時は route_times を全置換。 */
  routeTimes: routeTimeList.optional(),
});

// ---------------------------------------------------------------------------
// participations（upsert: unique(event_id, member_id)）
// ---------------------------------------------------------------------------

/** role 以外の共通フィールド（create/update 共用。すべて optional）。 */
const participationOptionalBody = {
  /** seatsAvailable（同乗可能人数, 自分以外）。保存時 +1 で capacity_override に。 */
  capacityOverrideSeats: seatsAvailable.nullable().optional(),
  willingness: z.enum(["always", "if_needed"]).nullable().optional(),
  earliestDepartureOverride: timeString.nullable().optional(),
  fixedDriverMemberId: z.string().uuid().nullable().optional(),
  pickupPrefsOverride: pickupPrefList.nullable().optional(),
  startTime: timeString.nullable().optional(),
  className: z.string().trim().max(40).nullable().optional(),
  estCourseMin: z
    .number()
    .int()
    .nonnegative()
    .max(EST_COURSE_MIN_MAX, {
      message: `競技予想時間は${EST_COURSE_MIN_MAX}分以内で入力してください`,
    })
    .nullable()
    .optional(),
  entrySource: z.enum(["auto", "manual"]).optional(),
  notes: z.string().max(1000).nullable().optional(),
};

/** POST（新規 upsert）: role 必須。'undecided' は検出一括登録の「回答待ち」状態を表す。 */
export const participationCreateSchema = z.object({
  ...actorEnvelope,
  memberId: z.string().uuid(),
  role: z.enum(["driver", "rider", "self", "absent", "undecided"]),
  ...participationOptionalBody,
});

/** PATCH（真の部分更新）: memberId で行を特定し、提供されたフィールドのみ更新。role も任意。 */
export const participationUpdateSchema = z.object({
  ...actorEnvelope,
  memberId: z.string().uuid(),
  role: z.enum(["driver", "rider", "self", "absent", "undecided"]).optional(),
  ...participationOptionalBody,
});

/**
 * 検出パネルからの一括参加登録（bulk）専用スキーマ。
 * role は固定 'undecided'（回答待ち）なので body に role は取らない。
 * 各行は既存メンバー（memberId）か新規メンバー（newMember）のいずれか一方を指定する。
 */
export const participationBulkSchema = z.object({
  ...actorEnvelope,
  entries: z
    .array(
      z
        .object({
          // 既存メンバーを指定する場合
          memberId: z.string().uuid().optional(),
          // 新規メンバーを作る場合（memberId と排他。どちらか必須）
          newMember: z
            .object({
              displayName: z.string().trim().min(1).max(40),
              athleteKey: z.string().trim().min(1).max(120),
            })
            .optional(),
          // 表示用（任意・検出由来のクラス）
          className: z.string().trim().max(40).nullable().optional(),
        })
        .refine((e) => (e.memberId != null) !== (e.newMember != null), {
          message: "各行は既存メンバーか新規メンバーのいずれか一方を指定してください",
        }),
    )
    .min(1, { message: "登録する対象がありません" })
    .max(PARTICIPATION_BULK_LIMIT, {
      message: `一度に登録できるのは${PARTICIPATION_BULK_LIMIT}人までです`,
    }),
});

// ---------------------------------------------------------------------------
// 型エクスポート（ハンドラ・テストで参照）
// ---------------------------------------------------------------------------

export type ClubCreateInput = z.infer<typeof clubCreateSchema>;
export type ClubUpdateInput = z.infer<typeof clubUpdateSchema>;
export type NodeCreateInput = z.infer<typeof nodeCreateSchema>;
export type NodeUpdateInput = z.infer<typeof nodeUpdateSchema>;
export type MemberCreateInput = z.infer<typeof memberCreateSchema>;
export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>;
export type TravelTimesPutInput = z.infer<typeof travelTimesPutSchema>;
export type EventCreateInput = z.infer<typeof eventCreateSchema>;
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;
export type RouteCreateInput = z.infer<typeof routeCreateSchema>;
export type RouteUpdateInput = z.infer<typeof routeUpdateSchema>;
export type ParticipationCreateInput = z.infer<typeof participationCreateSchema>;
export type ParticipationUpdateInput = z.infer<typeof participationUpdateSchema>;
export type ParticipationBulkInput = z.infer<typeof participationBulkSchema>;
