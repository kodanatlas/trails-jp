/**
 * 配車プラン（carpool_plans / plan_cars / plan_riders）の zod スキーマと DTO。
 *
 * 既存 schemas.ts / mappers.ts には触れず、プラン系だけをこのファイルに分離する
 * （Phase 3 で追加。version はサーバが max+1 で採番するため body には取らない）。
 */

import { z } from "zod";
import { actorName, timeString } from "./schemas";

// ---------------------------------------------------------------------------
// POST /plans のリクエストスキーマ
// ---------------------------------------------------------------------------

/** plan_riders 1 行（同乗者割当）。board_time は "HH:MM"。 */
const planRiderSchema = z.object({
  memberId: z.string().uuid(),
  nodeId: z.string().uuid(),
  /** 乗車時刻（後処理 expandSchedule の board(p)）。null 可。 */
  boardTime: timeString.nullable().optional(),
  locked: z.boolean().optional(),
});

/** plan_cars 1 行（運転手・ルート・経由ノード順・出発/到着時刻 + 同乗者）。 */
const planCarSchema = z.object({
  driverMemberId: z.string().uuid(),
  routeId: z.string().uuid().nullable().optional(),
  /** 経由する乗車地点ノード（順序つき）。 */
  pickupNodeIds: z.array(z.string().uuid()).max(20).default([]),
  departureTime: timeString.nullable().optional(),
  arrivalTime: timeString.nullable().optional(),
  /** 往復費用（円。Phase 4 で割り勘に使う。Phase 3 は null/未指定可）。 */
  costYen: z.number().int().nonnegative().max(1000000).nullable().optional(),
  /**
   * 出発時刻リコメンド（通常案/渋滞回避案）。形は Phase 4 で確定するため
   * unknown のままだが、任意 jsonb の肥大化を防ぐためシリアライズ長を制限する。
   */
  recommendedDeparture: z
    .unknown()
    .optional()
    .refine((v) => v === undefined || (JSON.stringify(v) ?? "").length <= 2000, {
      message: "recommendedDeparture が大きすぎます",
    }),
  riders: z.array(planRiderSchema).max(20).default([]),
});

/** locks（UI ボード由来）。SolveInput.locks と同形だが driverId は driver の member_id。 */
const planLockSchema = z.object({
  memberId: z.string().uuid().optional(),
  driverId: z.string().uuid(),
  nodeId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
});

/** weights（保存用。03 §5。範囲のみ緩く検査）。 */
const planWeightsSchema = z.object({
  drive: z.number().nonnegative().max(10000),
  spread: z.number().nonnegative().max(10000),
  access: z.number().nonnegative().max(10000),
  risk: z.number().nonnegative().max(10000),
  car: z.number().nonnegative().max(10000),
  soft: z.number().nonnegative().max(10000),
});

/** kpi（保存用。ソルバ統計を含む任意キーは passthrough しないが主要4指標は数値・上限つき）。 */
const planKpiSchema = z.object({
  totalDriveMin: z.number().nonnegative().max(1000000),
  totalAccessMin: z.number().nonnegative().max(1000000),
  maxSpreadMin: z.number().nonnegative().max(1000000),
  carsUsed: z.number().int().nonnegative().max(1000),
});

export const planCreateSchema = z
  .object({
    actorName,
    kind: z.literal("outbound"),
    status: z.enum(["draft", "published"]),
    locks: z.array(planLockSchema).max(200).default([]),
    weights: planWeightsSchema,
    kpi: planKpiSchema,
    cars: z.array(planCarSchema).max(50).default([]),
  })
  .superRefine((val, ctx) => {
    // 空の公開版が「最新公開版」として結果ページの表示を上書きするのを防ぐ。
    if (val.status === "published" && val.cars.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "公開する配車案に車がありません",
      });
    }
    // 割当制約(1)との整合: driver の車重複・同一メンバーの複数車割当・
    // 運転手の他車同乗を拒否する（DB にユニーク制約が無いため API 層で固定）。
    const driverIds = new Set<string>();
    const riderIds = new Set<string>();
    for (const car of val.cars) {
      if (driverIds.has(car.driverMemberId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "同じ運転手の車が複数含まれています",
        });
      }
      driverIds.add(car.driverMemberId);
      for (const r of car.riders) {
        if (riderIds.has(r.memberId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "同じメンバーが複数の車に割り当てられています",
          });
        }
        riderIds.add(r.memberId);
      }
    }
    for (const rid of riderIds) {
      if (driverIds.has(rid)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "運転手が他の車の同乗者としても割り当てられています",
        });
      }
    }
  });

export type PlanCreateInput = z.infer<typeof planCreateSchema>;
export type PlanCarInput = z.infer<typeof planCarSchema>;
export type PlanRiderInput = z.infer<typeof planRiderSchema>;

// ---------------------------------------------------------------------------
// DTO（GET レスポンス。UI 契約）
// ---------------------------------------------------------------------------

export interface PlanRiderDTO {
  memberId: string;
  carDriverMemberId: string;
  nodeId: string | null;
  boardTime: string | null;
  locked: boolean;
}

export interface PlanCarDTO {
  driverMemberId: string;
  routeId: string | null;
  pickupNodeIds: string[];
  departureTime: string | null;
  arrivalTime: string | null;
  costYen: number | null;
  recommendedDeparture: unknown | null;
  riders: PlanRiderDTO[];
}

export interface PlanMetaDTO {
  id: string;
  eventId: string;
  version: number;
  kind: "outbound" | "return";
  status: "draft" | "published";
  locks: unknown;
  weights: unknown;
  kpi: unknown;
  createdAt: string;
}

export interface PlanDetailDTO extends PlanMetaDTO {
  cars: PlanCarDTO[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export function toPlanMetaDTO(r: any): PlanMetaDTO {
  return {
    id: r.id,
    eventId: r.event_id,
    version: r.version,
    kind: r.kind,
    status: r.status,
    locks: r.locks ?? null,
    weights: r.weights ?? null,
    kpi: r.kpi ?? null,
    createdAt: r.created_at,
  };
}

export function toPlanRiderDTO(r: any): PlanRiderDTO {
  return {
    memberId: r.member_id,
    carDriverMemberId: r.car_driver_member_id,
    nodeId: r.pickup_node_id ?? null,
    boardTime: r.board_time ?? null,
    locked: !!r.locked,
  };
}

export function toPlanCarDTO(r: any, riders: PlanRiderDTO[]): PlanCarDTO {
  return {
    driverMemberId: r.driver_member_id,
    routeId: r.route_id ?? null,
    pickupNodeIds: Array.isArray(r.pickup_node_ids) ? r.pickup_node_ids : [],
    departureTime: r.departure_time ?? null,
    arrivalTime: r.arrival_time ?? null,
    costYen: r.cost_yen ?? null,
    recommendedDeparture: r.recommended_departure ?? null,
    riders,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
