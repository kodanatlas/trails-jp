import { describe, it, expect } from "vitest";
import {
  buildPlanInput,
  timeToMin,
  WEIGHT_PRESETS,
  type PlanInputData,
} from "../plan-input";
import { DEFAULT_WEIGHTS } from "../solver/types";
import type {
  EventDTO,
  RouteDTO,
  ParticipationDTO,
  MemberDTO,
  NodeDTO,
  TravelTimeDTO,
} from "../api/mappers";

// ---------------------------------------------------------------------------
// フィクスチャ・ビルダ（DTO を簡潔に作る）
// ---------------------------------------------------------------------------

const ISO = "2026-06-12T00:00:00Z";

function node(id: string, kind: NodeDTO["kind"], name = id): NodeDTO {
  return {
    id,
    clubId: "club1",
    kind,
    name,
    lat: null,
    lng: null,
    parking: false,
    note: null,
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function member(id: string, over: Partial<MemberDTO> = {}): MemberDTO {
  return {
    id,
    clubId: "club1",
    displayName: id,
    athleteKey: null,
    homeNodeId: `${id}_home`,
    hasCar: false,
    seatsAvailable: null,
    defaultWillingness: "always",
    earliestDeparture: null,
    luggageInCar: true,
    active: true,
    pickupPrefs: [],
    createdAt: ISO,
    updatedAt: ISO,
    ...over,
  };
}

function participation(
  memberId: string,
  role: ParticipationDTO["role"],
  over: Partial<ParticipationDTO> = {},
): ParticipationDTO {
  return {
    id: `p_${memberId}`,
    eventId: "ev1",
    memberId,
    role,
    capacityOverrideSeats: null,
    willingness: null,
    earliestDepartureOverride: null,
    fixedDriverMemberId: null,
    pickupPrefsOverride: null,
    startTime: null,
    className: null,
    estCourseMin: null,
    entrySource: "manual",
    notes: null,
    createdAt: ISO,
    updatedAt: ISO,
    ...over,
  };
}

const baseEvent: EventDTO = {
  id: "ev1",
  clubId: "club1",
  joeEventId: null,
  name: "テスト大会",
  eventDate: "2026-06-12",
  venueNodeId: "venue1",
  bufferMin: 75,
  status: "planning",
  bulletinUrl: null,
  startlistUrl: null,
  createdAt: ISO,
  updatedAt: ISO,
};

function route(id: string, minutes: Record<string, number>, riskScore = 0): RouteDTO {
  return {
    id,
    eventId: "ev1",
    name: id,
    tollYen: 0,
    distanceKm: 0,
    riskScore,
    riskWindows: [],
    routeTimes: Object.entries(minutes).map(([nodeId, minutesToVenue]) => ({
      nodeId,
      minutesToVenue,
    })),
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function tt(
  from: string,
  to: string,
  mode: TravelTimeDTO["mode"],
  minutes: number,
): TravelTimeDTO {
  return { fromNodeId: from, toNodeId: to, mode, minutes, source: "manual", updatedAt: ISO };
}

// ---------------------------------------------------------------------------
// timeToMin
// ---------------------------------------------------------------------------

describe("timeToMin", () => {
  it("parses HH:MM without rounding", () => {
    expect(timeToMin("10:45")).toBe(645);
    expect(timeToMin("11:07")).toBe(667); // 11*60+7, not rounded to a 15 boundary
    expect(timeToMin("00:00")).toBe(0);
    expect(timeToMin("23:59")).toBe(1439);
  });
  it("accepts HH:MM:SS (DB time)", () => {
    expect(timeToMin("06:05:00")).toBe(365);
  });
  it("returns null for null/invalid", () => {
    expect(timeToMin(null)).toBeNull();
    expect(timeToMin(undefined)).toBeNull();
    expect(timeToMin("nope")).toBeNull();
    expect(timeToMin("25:00")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildPlanInput
// ---------------------------------------------------------------------------

describe("buildPlanInput — membership filtering", () => {
  it("excludes self / absent / undecided, keeps driver / rider", () => {
    const members = [
      member("d1", { seatsAvailable: 3 }),
      member("r1"),
      member("s1"),
      member("a1"),
      member("u1"),
    ];
    const participations = [
      participation("d1", "driver"),
      participation("r1", "rider"),
      participation("s1", "self"),
      participation("a1", "absent"),
      participation("u1", "undecided"),
    ];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90, r1_home: 100 })],
      participations,
      members,
      nodes: [node("venue1", "venue")],
      travelTimes: [],
    };
    const { input } = buildPlanInput(data);
    const ids = input.members.map((m) => m.id).sort();
    expect(ids).toEqual(["d1", "r1"]);
    expect(input.cars.map((c) => c.driverId)).toEqual(["d1"]);
  });
});

describe("buildPlanInput — capacity +1 conversion", () => {
  it("converts seatsAvailable (others) to capacity (driver included) with +1", () => {
    const members = [member("d1", { seatsAvailable: 3 })];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90 })],
      participations: [participation("d1", "driver")],
      members,
      nodes: [],
      travelTimes: [],
    };
    const { input } = buildPlanInput(data);
    expect(input.cars[0].capacity).toBe(4); // 3 seats + driver
  });

  it("prefers capacityOverrideSeats over member default, still +1", () => {
    const members = [member("d1", { seatsAvailable: 3 })];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90 })],
      participations: [
        participation("d1", "driver", { capacityOverrideSeats: 1 }),
      ],
      members,
      nodes: [],
      travelTimes: [],
    };
    const { input } = buildPlanInput(data);
    expect(input.cars[0].capacity).toBe(2); // override 1 + driver
  });
});

describe("buildPlanInput — override priority", () => {
  it("prefers participation willingness/earliestDep over member defaults", () => {
    const members = [
      member("d1", {
        seatsAvailable: 2,
        defaultWillingness: "always",
        earliestDeparture: "05:00",
      }),
    ];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90 })],
      participations: [
        participation("d1", "driver", {
          willingness: "if_needed",
          earliestDepartureOverride: "06:30",
        }),
      ],
      members,
      nodes: [],
      travelTimes: [],
    };
    const { input } = buildPlanInput(data);
    expect(input.cars[0].willingness).toBe("if_needed");
    expect(input.cars[0].earliestDepMin).toBe(390); // 06:30
  });

  it("falls back to member defaults when participation overrides are null", () => {
    const members = [
      member("d1", {
        seatsAvailable: 2,
        defaultWillingness: "if_needed",
        earliestDeparture: "05:15",
      }),
    ];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90 })],
      participations: [participation("d1", "driver")],
      members,
      nodes: [],
      travelTimes: [],
    };
    const { input } = buildPlanInput(data);
    expect(input.cars[0].willingness).toBe("if_needed");
    expect(input.cars[0].earliestDepMin).toBe(315); // 05:15
  });

  it("prefers pickupPrefsOverride over member pickupPrefs and splits hard/soft", () => {
    const members = [
      member("d1", {
        seatsAvailable: 2,
        pickupPrefs: [{ nodeId: "stationA", strength: "hard" }],
      }),
    ];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90 })],
      participations: [
        participation("d1", "driver", {
          pickupPrefsOverride: [
            { nodeId: "stationB", strength: "hard" },
            { nodeId: "stationC", strength: "soft" },
          ],
        }),
      ],
      members,
      nodes: [node("stationB", "pickup"), node("stationC", "pickup")],
      travelTimes: [],
    };
    const { input } = buildPlanInput(data);
    expect(input.cars[0].hardNodes).toEqual(["stationB"]);
    expect(input.cars[0].softNodes).toEqual(["stationC"]);
  });

  it("hardNodes is null when member has only soft prefs (= all nodes allowed)", () => {
    const members = [
      member("d1", {
        seatsAvailable: 2,
        pickupPrefs: [{ nodeId: "stationA", strength: "soft" }],
      }),
    ];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90 })],
      participations: [participation("d1", "driver")],
      members,
      nodes: [node("stationA", "pickup")],
      travelTimes: [],
    };
    const { input } = buildPlanInput(data);
    expect(input.cars[0].hardNodes).toBeNull();
    expect(input.cars[0].softNodes).toEqual(["stationA"]);
  });
});

describe("buildPlanInput — fixed conversion", () => {
  it("maps rider.fixedDriverMemberId to fixed[]", () => {
    const members = [member("d1", { seatsAvailable: 3 }), member("r1")];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90, r1_home: 100 })],
      participations: [
        participation("d1", "driver"),
        participation("r1", "rider", { fixedDriverMemberId: "d1" }),
      ],
      members,
      nodes: [],
      travelTimes: [],
    };
    const { input } = buildPlanInput(data);
    expect(input.fixed).toEqual([{ memberId: "r1", driverId: "d1" }]);
  });

  it("escalates to error when fixed driver is not registered as a driver (M5)", () => {
    const members = [member("d1", { seatsAvailable: 3 }), member("r1")];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90, r1_home: 100 })],
      participations: [
        participation("d1", "driver"),
        participation("r1", "rider", { fixedDriverMemberId: "ghost" }),
      ],
      members,
      nodes: [],
      travelTimes: [],
    };
    const { input, errors } = buildPlanInput(data);
    expect(input.fixed).toEqual([{ memberId: "r1", driverId: "ghost" }]);
    expect(
      errors.some((e) => e.includes("確約先") && e.includes("運転手ではありません")),
    ).toBe(true);
  });
});

describe("buildPlanInput — startMin & provisional", () => {
  it("parses startTime to minutes with no 15-min rounding", () => {
    const members = [member("d1", { seatsAvailable: 3 }), member("r1")];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90, r1_home: 100 })],
      participations: [
        participation("d1", "driver", { startTime: "10:07" }),
        participation("r1", "rider", { startTime: "11:23" }),
      ],
      members,
      nodes: [],
      travelTimes: [],
    };
    const { input } = buildPlanInput(data);
    const byId = Object.fromEntries(input.members.map((m) => [m.id, m.startMin]));
    expect(byId.d1).toBe(607); // 10:07, not 600 or 615
    expect(byId.r1).toBe(683); // 11:23
    expect(input.options.provisional).toBe(false);
  });

  it("nulls all startMin and sets provisional=true in provisional mode", () => {
    const members = [member("d1", { seatsAvailable: 3 }), member("r1")];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90, r1_home: 100 })],
      participations: [
        participation("d1", "driver", { startTime: "10:07" }),
        participation("r1", "rider", { startTime: "11:23" }),
      ],
      members,
      nodes: [],
      travelTimes: [],
    };
    const { input } = buildPlanInput(data, { provisional: true });
    expect(input.members.every((m) => m.startMin === null)).toBe(true);
    expect(input.options.provisional).toBe(true);
  });

  it("warns about missing start times in confirmed mode only", () => {
    const members = [member("d1", { seatsAvailable: 3 }), member("r1")];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90, r1_home: 100 })],
      participations: [
        participation("d1", "driver", { startTime: "10:00" }),
        participation("r1", "rider"), // no start time
      ],
      members,
      nodes: [],
      travelTimes: [],
    };
    const confirmed = buildPlanInput(data);
    expect(confirmed.warnings.some((w) => w.includes("スタート時刻が未入力"))).toBe(true);
    const provisional = buildPlanInput(data, { provisional: true });
    expect(provisional.warnings.some((w) => w.includes("スタート時刻が未入力"))).toBe(false);
  });
});

describe("buildPlanInput — pickupNodes & travel", () => {
  it("pickupNodes = kind=pickup nodes + rider home nodes", () => {
    const members = [member("d1", { seatsAvailable: 3 }), member("r1")];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90, r1_home: 100, stationX: 80 })],
      participations: [
        participation("d1", "driver"),
        participation("r1", "rider"),
      ],
      members,
      nodes: [node("stationX", "pickup"), node("venue1", "venue")],
      travelTimes: [],
    };
    const { input } = buildPlanInput(data);
    expect(input.pickupNodes.sort()).toEqual(["r1_home", "stationX"].sort());
  });

  it("builds car/transit dictionaries keyed by from>to", () => {
    const members = [member("d1", { seatsAvailable: 3 }), member("r1")];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90, r1_home: 100 })],
      participations: [
        participation("d1", "driver"),
        participation("r1", "rider"),
      ],
      members,
      nodes: [],
      travelTimes: [
        tt("d1_home", "r1_home", "car", 12),
        tt("r1_home", "stationX", "transit", 20),
      ],
    };
    const { input } = buildPlanInput(data);
    expect(input.travel.car["d1_home>r1_home"]).toBe(12);
    expect(input.travel.transit["r1_home>stationX"]).toBe(20);
  });
});

describe("buildPlanInput — weights & options", () => {
  it("defaults to DEFAULT_WEIGHTS and event.bufferMin", () => {
    const members = [member("d1", { seatsAvailable: 3 })];
    const data: PlanInputData = {
      event: { ...baseEvent, bufferMin: 90 },
      routes: [route("k1", { d1_home: 90 })],
      participations: [participation("d1", "driver")],
      members,
      nodes: [],
      travelTimes: [],
    };
    const { input } = buildPlanInput(data);
    expect(input.weights).toEqual(DEFAULT_WEIGHTS);
    expect(input.options.bufferMin).toBe(90);
  });

  it("applies a weight preset when passed", () => {
    const members = [member("d1", { seatsAvailable: 3 })];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90 })],
      participations: [participation("d1", "driver")],
      members,
      nodes: [],
      travelTimes: [],
    };
    const { input } = buildPlanInput(data, { weights: WEIGHT_PRESETS.wait });
    expect(input.weights.spread).toBe(3);
  });
});

describe("buildPlanInput — assembly warnings", () => {
  it("warns when a driver home has no route_time to venue", () => {
    const members = [member("d1", { seatsAvailable: 3 })];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", {})], // no d1_home entry
      participations: [participation("d1", "driver")],
      members,
      nodes: [node("d1_home", "area", "自宅A")],
      travelTimes: [],
    };
    const { warnings } = buildPlanInput(data);
    expect(warnings.some((w) => w.includes("移動時間が未入力") && w.includes("会場"))).toBe(true);
  });

  it("escalates missing home node to error (silent drop prevention, B1)", () => {
    const members = [member("d1", { seatsAvailable: 3, homeNodeId: null })];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", {})],
      participations: [participation("d1", "driver")],
      members,
      nodes: [],
      travelTimes: [],
    };
    const { input, errors } = buildPlanInput(data);
    expect(input.members.length).toBe(0);
    expect(
      errors.some((e) => e.includes("乗車エリア") && e.includes("未設定")),
    ).toBe(true);
    // 唯一の運転手が脱落した結果、運転手0もエラーになる。
    expect(errors.some((e) => e.includes("運転手が登録されていません"))).toBe(true);
  });
});

describe("buildPlanInput — blocking errors (B1)", () => {
  it("errors when the venue node is unset", () => {
    const members = [member("d1", { seatsAvailable: 3 })];
    const data: PlanInputData = {
      event: { ...baseEvent, venueNodeId: null },
      routes: [route("k1", { d1_home: 90 })],
      participations: [participation("d1", "driver")],
      members,
      nodes: [],
      travelTimes: [],
    };
    const { errors } = buildPlanInput(data);
    expect(errors.some((e) => e.includes("会場・駐車場の場所が未設定"))).toBe(true);
  });

  it("errors when no route candidates are registered", () => {
    const members = [member("d1", { seatsAvailable: 3 })];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [],
      participations: [participation("d1", "driver")],
      members,
      nodes: [],
      travelTimes: [],
    };
    const { errors, warnings } = buildPlanInput(data);
    expect(errors.some((e) => e.includes("ルート候補が登録されていません"))).toBe(true);
    expect(warnings.some((w) => w.includes("ルート候補"))).toBe(false);
  });

  it("errors when there is no driver", () => {
    const members = [member("r1")];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { r1_home: 100 })],
      participations: [participation("r1", "rider")],
      members,
      nodes: [],
      travelTimes: [],
    };
    const { errors } = buildPlanInput(data);
    expect(errors.some((e) => e.includes("運転手が登録されていません"))).toBe(true);
  });

  it("errors when a rider has no boardable node on any route", () => {
    const members = [member("d1", { seatsAvailable: 3 }), member("r1")];
    const data: PlanInputData = {
      event: baseEvent,
      // ルートは運転手の自宅のみカバー。r1 の自宅も pickup ノードも未登録。
      routes: [route("k1", { d1_home: 90 })],
      participations: [
        participation("d1", "driver"),
        participation("r1", "rider"),
      ],
      members,
      nodes: [],
      travelTimes: [],
    };
    const { errors } = buildPlanInput(data);
    expect(errors.some((e) => e.includes("r1") && e.includes("乗車できる地点"))).toBe(true);
  });

  it("does not error reachability when a pickup node is covered by a route", () => {
    const members = [member("d1", { seatsAvailable: 3 }), member("r1")];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90, stationX: 80 })],
      participations: [
        participation("d1", "driver"),
        participation("r1", "rider"),
      ],
      members,
      nodes: [node("stationX", "pickup")],
      travelTimes: [],
    };
    const { errors } = buildPlanInput(data);
    expect(errors.some((e) => e.includes("乗車できる地点"))).toBe(false);
  });

  it("returns no errors for a complete, runnable dataset", () => {
    const members = [member("d1", { seatsAvailable: 3 }), member("r1")];
    const data: PlanInputData = {
      event: baseEvent,
      routes: [route("k1", { d1_home: 90, r1_home: 100 })],
      participations: [
        participation("d1", "driver", { startTime: "10:00" }),
        participation("r1", "rider", { startTime: "10:30" }),
      ],
      members,
      nodes: [node("venue1", "venue")],
      travelTimes: [],
    };
    const { errors } = buildPlanInput(data);
    expect(errors).toEqual([]);
  });
});
