/**
 * 配車プラン入力の組み立て（純粋関数）。
 *
 * イベント詳細 DTO（event + routes + participations）+ メンバー DTO + ノード DTO +
 * 移動時間 DTO を、ソルバの `SolveInput`（03 §9 契約）へ決定論的に変換する。
 *
 * 変換ルールの正本（02 データモデル / 03 最適化モデルに準拠）:
 *   - M = participations の role が driver / rider のみ。self / absent / undecided は **除外**。
 *   - cars = role=driver。capacity は「運転手込みの定員」。DTO は seatsAvailable（自分以外）
 *     で来るため **+1** する。capacityOverrideSeats があれば member 既定より優先。
 *   - willingness / earliestDep は participation override 優先 → member 既定にフォールバック。
 *   - hardNodes / softNodes は participation.pickupPrefsOverride 優先 → member.pickupPrefs。
 *     strength=hard を hardNodes、soft を softNodes に振り分ける。
 *   - riders の fixedDriverMemberId → fixed[]。
 *   - startMin = participation.startTime（"HH:MM" → 0時からの分）。**15分丸めはしない**。
 *     暫定モードでは provisional=true（ソルバ側で (15)(16)/w_spread が落ちる）。
 *   - routes は carpool_routes + routeTimes → minutesToVenue。riskScore はそのまま。
 *   - pickupNodes = kind=pickup の全ノード + rider の homeNodeId。
 *   - travel = travelTimes を "from>to" キーの car / transit 辞書に。
 *
 * この関数は DB に触れない。warnings は画面の実行前チェック表示に使う
 * （ソルバの validate とは別の、組み立て段階で分かる不足の早期提示）。
 */

import type {
  SolveInput,
  Member,
  Car,
  Route,
  FixedAssignment,
  Weights,
  SolveOptions,
} from "./solver/types";
import type {
  EventDTO,
  RouteDTO,
  ParticipationDTO,
  MemberDTO,
  NodeDTO,
  TravelTimeDTO,
  PickupPrefDTO,
} from "./api/mappers";

// ---------------------------------------------------------------------------
// 入出力型
// ---------------------------------------------------------------------------

/** plan-input が受け取る DTO 束（イベント詳細 GET + メンバー/ノード/移動時間 GET の合成）。 */
export interface PlanInputData {
  event: EventDTO;
  routes: RouteDTO[];
  participations: ParticipationDTO[];
  members: MemberDTO[];
  nodes: NodeDTO[];
  travelTimes: TravelTimeDTO[];
}

/** 組み立てオプション（UI トグルから渡す）。 */
export interface BuildPlanInputOptions {
  /** 暫定モード（スタート時刻を無視し (15)(16)/w_spread を落とす）。 */
  provisional?: boolean;
  /** 重み（未指定は DEFAULT_WEIGHTS）。 */
  weights?: Weights;
  /** ロック（UI のボード操作由来）。SolveInput.locks にそのまま渡す。 */
  locks?: SolveInput["locks"];
  /** 到着バッファ分の上書き（未指定は event.bufferMin）。 */
  bufferMin?: number;
  /** 立寄り上限（未指定は DEFAULT_OPTIONS.maxPickups）。 */
  maxPickups?: number;
  /** アクセス上限分（未指定は DEFAULT_OPTIONS.accessMaxMin）。 */
  accessMaxMin?: number;
}

export interface BuildPlanInputResult {
  input: SolveInput;
  /** 組み立て段階で分かった不足・注意（日本語）。実行前チェック表示に使う。 */
  warnings: string[];
  /**
   * 実行をブロックすべきエラー（日本語）。
   * 黙って infeasible / メンバー脱落につながるデータ不足はここに昇格させる:
   *   - 会場ノード未設定 / ルート候補0件 / 運転手0人
   *   - driver/rider 参加者のメンバー未登録・自宅エリア未設定（= M から黙って脱落する）
   *   - 確約先が運転手でない（fixed が解決不能 = ソルバで必ず矛盾）
   *   - 同乗希望者の乗車可能地点がどのルートにも未登録（到達可能性なし）
   * UI はこれが空でない限り「最適化を実行」を無効化する。
   */
  errors: string[];
}

// DEFAULT_WEIGHTS / DEFAULT_OPTIONS / プリセットは types から再エクスポートして UI と共有する。
import {
  DEFAULT_WEIGHTS,
  DEFAULT_OPTIONS,
} from "./solver/types";

// ---------------------------------------------------------------------------
// 重みプリセット（03 §5）
// ---------------------------------------------------------------------------

export type WeightPresetKey = "balanced" | "wait" | "drive";

/** 03 §5 のプリセット。バランス=既定、待ち時間重視=w_spread×3、運転負担重視=w_drive×2 + w_car×2。 */
export const WEIGHT_PRESETS: Record<WeightPresetKey, Weights> = {
  balanced: { ...DEFAULT_WEIGHTS },
  wait: { ...DEFAULT_WEIGHTS, spread: 3 },
  drive: { ...DEFAULT_WEIGHTS, drive: 2, car: 120 },
};

export const WEIGHT_PRESET_LABELS: Record<WeightPresetKey, string> = {
  balanced: "バランス",
  wait: "待ち時間重視",
  drive: "運転負担重視",
};

// ---------------------------------------------------------------------------
// 時刻パース
// ---------------------------------------------------------------------------

/**
 * "HH:MM"（任意で "HH:MM:SS"）→ 0時からの分。**丸めは行わない**。
 * 不正形式・null・undefined は null を返す。
 */
export function timeToMin(t: string | null | undefined): number | null {
  if (t === null || t === undefined) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

// ---------------------------------------------------------------------------
// pickup prefs の正規化（override 優先 → member 既定）
// ---------------------------------------------------------------------------

/**
 * pickupPrefsOverride は participations.pickup_prefs_override(jsonb) 由来で
 * 形は PickupPrefDTO[]（{nodeId, strength}）を想定する。配列でなければ無視。
 */
function asPickupPrefs(value: unknown): PickupPrefDTO[] | null {
  if (!Array.isArray(value)) return null;
  const out: PickupPrefDTO[] = [];
  for (const v of value) {
    if (
      v &&
      typeof v === "object" &&
      typeof (v as { nodeId?: unknown }).nodeId === "string" &&
      ((v as { strength?: unknown }).strength === "hard" ||
        (v as { strength?: unknown }).strength === "soft")
    ) {
      out.push({
        nodeId: (v as PickupPrefDTO).nodeId,
        strength: (v as PickupPrefDTO).strength,
      });
    }
  }
  return out;
}

/** prefs を hard/soft に振り分け。hard が1つも無ければ hardNodes=null（= 全地点許可）。 */
function splitPrefs(prefs: PickupPrefDTO[]): {
  hardNodes: string[] | null;
  softNodes: string[];
} {
  const hard: string[] = [];
  const soft: string[] = [];
  for (const p of prefs) {
    if (p.strength === "hard") hard.push(p.nodeId);
    else soft.push(p.nodeId);
  }
  return {
    hardNodes: hard.length > 0 ? Array.from(new Set(hard)) : null,
    softNodes: Array.from(new Set(soft)),
  };
}

// ---------------------------------------------------------------------------
// メイン: DTO → SolveInput
// ---------------------------------------------------------------------------

export function buildPlanInput(
  data: PlanInputData,
  options: BuildPlanInputOptions = {},
): BuildPlanInputResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const { event, routes, participations, members, nodes, travelTimes } = data;

  const provisional = options.provisional ?? false;

  // --- B1: 会場ノード必須（無いと到着地が定義できず、route_times も意味を持たない） ---
  if (!event.venueNodeId) {
    errors.push("会場・駐車場の場所が未設定です（大会の到着地を登録してください）");
  }

  // member 索引（id → DTO）と表示名（警告メッセージ用）。
  const memberById = new Map<string, MemberDTO>();
  for (const m of members) memberById.set(m.id, m);
  const nameOf = (id: string) => memberById.get(id)?.displayName ?? id;

  const nodeById = new Map<string, NodeDTO>();
  for (const n of nodes) nodeById.set(n.id, n);

  // --- M: role が driver / rider の participation のみ（self/absent/undecided 除外） ---
  const active = participations.filter(
    (p) => p.role === "driver" || p.role === "rider",
  );

  // member マスタに存在し、home_node_id を持つもののみ採用（home が無いと P に乗らない）。
  // 弾かれた参加者は M から「黙って脱落」するため、warning ではなく error にする（B1）。
  const solveMembers: Member[] = [];
  const driverParts: ParticipationDTO[] = [];
  const riderHomeNodeIds = new Set<string>();
  /** 採用された rider（到達可能性チェック用）。 */
  const riderInfos: { name: string; home: string }[] = [];

  for (const p of active) {
    const m = memberById.get(p.memberId);
    if (!m) {
      errors.push(
        `${nameOf(p.memberId)} さんがメンバー一覧に見つかりません（このままでは配車から漏れます）`,
      );
      continue;
    }
    if (!m.homeNodeId) {
      // R7: 乗車エリア未設定の rider/driver は割当不能のまま黙って脱落するため error。
      errors.push(
        `${m.displayName} さんの乗車エリア（自宅エリア）が未設定です。設定しないと配車の割当ができません`,
      );
      continue;
    }

    const startMin = provisional ? null : timeToMin(p.startTime);
    if (!provisional && p.startTime === null) {
      warnings.push(`${m.displayName} さんのスタート時刻が未入力です`);
    }

    solveMembers.push({
      id: m.id,
      startMin,
      homeNodeId: m.homeNodeId,
    });

    if (p.role === "driver") {
      driverParts.push(p);
    } else {
      // rider の自宅エリアも乗車地点候補になり得る（02 §2: kind=area も pickup）。
      riderHomeNodeIds.add(m.homeNodeId);
      riderInfos.push({ name: m.displayName, home: m.homeNodeId });
    }
  }

  const memberIdSet = new Set(solveMembers.map((m) => m.id));

  // --- cars: role=driver ---
  const cars: Car[] = [];
  for (const p of driverParts) {
    const m = memberById.get(p.memberId);
    if (!m || !memberIdSet.has(p.memberId)) continue; // 上で弾かれた driver は車も作らない

    // capacity: seatsAvailable（自分以外）→ +1（運転手込み）。override 優先。
    const seats =
      p.capacityOverrideSeats !== null && p.capacityOverrideSeats !== undefined
        ? p.capacityOverrideSeats
        : m.seatsAvailable;
    if (seats === null || seats === undefined) {
      warnings.push(`${m.displayName} さんの同乗可能人数が未設定です（定員不明）`);
    }
    const capacity = (seats ?? 0) + 1;

    // willingness: override 優先 → member 既定。
    const willingness: "always" | "if_needed" =
      p.willingness ?? m.defaultWillingness ?? "always";

    // earliestDep: override 優先 → member 既定。"HH:MM" → 分。
    const edRaw = p.earliestDepartureOverride ?? m.earliestDeparture ?? null;
    const earliestDepMin = timeToMin(edRaw);

    // pickup prefs: override 優先 → member.pickupPrefs。hard/soft 振り分け。
    const overridePrefs = asPickupPrefs(p.pickupPrefsOverride);
    const prefs = overridePrefs ?? m.pickupPrefs ?? [];
    const { hardNodes, softNodes } = splitPrefs(prefs);

    cars.push({
      driverId: m.id,
      capacity,
      willingness,
      earliestDepMin,
      hardNodes,
      softNodes,
    });
  }

  if (cars.length === 0) {
    errors.push("運転手が登録されていません");
  }

  // --- fixed: rider の fixedDriverMemberId ---
  const fixed: FixedAssignment[] = [];
  const driverIdSet = new Set(cars.map((c) => c.driverId));
  for (const p of active) {
    if (p.role !== "rider") continue;
    if (!memberIdSet.has(p.memberId)) continue;
    const fd = p.fixedDriverMemberId;
    if (!fd) continue;
    fixed.push({ memberId: p.memberId, driverId: fd });
    // M5: 確約先が driver でない fixed はソルバで必ず矛盾になるため error に昇格。
    if (!driverIdSet.has(fd)) {
      errors.push(
        `${nameOf(p.memberId)} さんの確約先（${nameOf(fd)} さん）は運転手ではありません`,
      );
    }
  }

  // --- routes: carpool_routes + routeTimes → minutesToVenue ---
  const solveRoutes: Route[] = routes.map((r) => {
    const minutesToVenue: Record<string, number> = {};
    for (const t of r.routeTimes ?? []) {
      minutesToVenue[t.nodeId] = t.minutesToVenue;
    }
    return {
      id: r.id,
      riskScore: r.riskScore ?? 0,
      minutesToVenue,
    };
  });

  if (solveRoutes.length === 0) {
    errors.push("ルート候補が登録されていません");
  }

  // --- pickupNodes: kind=pickup の全ノード + rider の homeNodeId ---
  const pickupSet = new Set<string>();
  for (const n of nodes) {
    if (n.kind === "pickup") pickupSet.add(n.id);
  }
  for (const hid of riderHomeNodeIds) pickupSet.add(hid);
  const pickupNodes = Array.from(pickupSet);

  // --- B1: 到達可能性（rider が乗れる地点がどのルートにも未登録なら実行不能） ---
  // coverable = いずれかのルートに minutesToVenue があるノード集合。
  // rider は「自宅 or いずれかの乗車地点」が coverable でないと、どの車にも乗れない
  // （transit の有無はソルバ validate が網羅する。ここは組み立て段階の粗い到達性のみ）。
  if (solveRoutes.length > 0) {
    const coverable = new Set<string>();
    for (const r of solveRoutes) {
      for (const nid of Object.keys(r.minutesToVenue)) coverable.add(nid);
    }
    const anyPickupCoverable = pickupNodes.some((p) => coverable.has(p));
    for (const ri of riderInfos) {
      if (!coverable.has(ri.home) && !anyPickupCoverable) {
        errors.push(
          `${ri.name} さんが乗車できる地点がどのルートにも未登録です（ルート所要時間を入力してください）`,
        );
      }
    }
  }

  // --- travel: travelTimes → "from>to" の car / transit 辞書 ---
  const car: Record<string, number> = {};
  const transit: Record<string, number> = {};
  for (const t of travelTimes) {
    const key = `${t.fromNodeId}>${t.toNodeId}`;
    if (t.mode === "car") car[key] = t.minutes;
    else if (t.mode === "transit") transit[key] = t.minutes;
  }

  // --- 組み立て段階のマトリクス欠損チェック（早期提示。詳細は solver.validate が網羅） ---
  // 各 driver の home→会場 が、いずれかのルートに route_time として無いと car は会場に到達できない。
  for (const c of cars) {
    const driver = memberById.get(c.driverId);
    const home = driver?.homeNodeId;
    if (!home) continue;
    const reachable = solveRoutes.some(
      (r) => r.minutesToVenue[home] !== undefined,
    );
    if (!reachable) {
      const homeName = (home && nodeById.get(home)?.name) || home;
      warnings.push(
        `移動時間が未入力: ${driver?.displayName ?? c.driverId} さんの自宅エリア(${homeName})→会場（ルート所要時間）`,
      );
    }
  }

  const weights: Weights = options.weights ?? { ...DEFAULT_WEIGHTS };

  const solveOptions: SolveOptions = {
    bufferMin: options.bufferMin ?? event.bufferMin ?? DEFAULT_OPTIONS.bufferMin,
    maxPickups: options.maxPickups ?? DEFAULT_OPTIONS.maxPickups,
    accessMaxMin: options.accessMaxMin ?? DEFAULT_OPTIONS.accessMaxMin,
    provisional,
  };

  const input: SolveInput = {
    members: solveMembers,
    cars,
    routes: solveRoutes,
    pickupNodes,
    travel: { car, transit },
    fixed,
    locks: options.locks ?? [],
    weights,
    options: solveOptions,
  };

  return {
    input,
    warnings: Array.from(new Set(warnings)),
    errors: Array.from(new Set(errors)),
  };
}
