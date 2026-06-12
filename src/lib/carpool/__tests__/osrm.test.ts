import { describe, it, expect, vi } from "vitest";
import {
  haversineKm,
  estimateTransitMinutes,
  estimateTransitFromCarMinutes,
  buildOsrmCoordsParam,
  buildOsrmTableUrl,
  parseOsrmDurations,
  buildSkipKeySet,
  buildCarUpserts,
  buildTransitUpserts,
  buildAutoUpserts,
  buildRouteTimesToVenue,
  fetchOsrmTable,
  sanitizeGeoNodes,
  CAR_MAX_SANE_MIN,
  TRANSIT_MAX_SANE_MIN,
  type GeoNode,
  type ExistingTravelTime,
  type FetchLike,
} from "../osrm";

const A: GeoNode = { id: "a", lat: 35.6895, lng: 139.6917 }; // 新宿付近
const B: GeoNode = { id: "b", lat: 35.4437, lng: 139.638 }; // 横浜付近
const V: GeoNode = { id: "v", lat: 35.61, lng: 139.62 };

describe("haversineKm", () => {
  it("新宿〜横浜は概ね 27〜30km", () => {
    const km = haversineKm(A, B);
    expect(km).toBeGreaterThan(25);
    expect(km).toBeLessThan(32);
  });
  it("同一点は 0", () => {
    expect(haversineKm(A, A)).toBeCloseTo(0, 5);
  });
});

describe("estimateTransitMinutes", () => {
  it("距離に応じた分を返し最低 5 分を下回らない", () => {
    const near: GeoNode = { id: "n", lat: 35.6896, lng: 139.6918 };
    expect(estimateTransitMinutes(A, near)).toBe(5);
  });
  it("長距離は整数分で増える", () => {
    const m = estimateTransitMinutes(A, B);
    expect(Number.isInteger(m)).toBe(true);
    expect(m).toBeGreaterThan(60);
  });
  it("目黒駅〜練馬駅は haversine fallback で >5・1440 ではない（クランプは廃止）", () => {
    const meguro: GeoNode = { id: "meguro", lat: 35.633, lng: 139.716 };
    const nerima: GeoNode = { id: "nerima", lat: 35.748, lng: 139.654 };
    const m = estimateTransitMinutes(meguro, nerima);
    expect(m).toBeGreaterThan(5);
    expect(m).not.toBe(1440);
    // haversine（直線距離）は都内の近接駅レンジ（10〜18km 程度）に収まる。
    const km = haversineKm(meguro, nerima);
    expect(km).toBeGreaterThan(10);
    expect(km).toBeLessThan(18);
  });
  it("クランプ廃止: 地球規模の距離では生値が 480 を超える", () => {
    // 沖縄相当の遠距離（東京〜lat26,lng127）でも頭打ちせず生値を返す。
    const tokyo: GeoNode = { id: "f1", lat: 35.6, lng: 139.7 };
    const okinawa: GeoNode = { id: "f2", lat: 26.0, lng: 127.0 };
    const m = estimateTransitMinutes(tokyo, okinawa);
    expect(m).toBeGreaterThan(TRANSIT_MAX_SANE_MIN); // クランプされない生値
  });
});

describe("estimateTransitFromCarMinutes", () => {
  it("car 22 分 → 50 分（22 * 1.6 + 15 = 50.2 → round 50）", () => {
    expect(estimateTransitFromCarMinutes(22)).toBe(50);
  });
  it("係数とバッファ: car 0 → 15 分", () => {
    expect(estimateTransitFromCarMinutes(0)).toBe(15);
  });
});

describe("buildOsrmCoordsParam / Url", () => {
  it("lng,lat;lng,lat 順で連結する", () => {
    expect(buildOsrmCoordsParam([A, B])).toBe("139.6917,35.6895;139.638,35.4437");
  });
  it("table URL は driving + annotations=duration", () => {
    const url = buildOsrmTableUrl([A, B]);
    expect(url).toContain("/table/v1/driving/");
    expect(url).toContain("annotations=duration");
  });
});

describe("parseOsrmDurations", () => {
  it("対角を除外し秒→分（四捨五入・最低1分）に変換", () => {
    const resp = { code: "Ok", durations: [[0, 600, 90], [600, 0, 30], [90, 30, 0]] };
    const out = parseOsrmDurations(resp);
    // 3x3 で対角3つ除く = 6 ペア
    expect(out).toHaveLength(6);
    const ab = out.find((d) => d.fromIndex === 0 && d.toIndex === 1);
    expect(ab?.minutes).toBe(10); // 600s → 10min
    const bc = out.find((d) => d.fromIndex === 1 && d.toIndex === 2);
    expect(bc?.minutes).toBe(1); // 30s → 0.5 → round 1 → max(1,..)=1
  });
  it("null 所要（経路なし）は除外", () => {
    const resp = { code: "Ok", durations: [[0, null], [120, 0]] };
    const out = parseOsrmDurations(resp);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ fromIndex: 1, toIndex: 0, minutes: 2 });
  });
  it("code が Ok でなければ空", () => {
    expect(parseOsrmDurations({ code: "NoRoute", durations: [[0]] })).toEqual([]);
  });
  it("durations が行列でなければ空", () => {
    expect(parseOsrmDurations({ code: "Ok", durations: "x" })).toEqual([]);
  });
});

describe("buildSkipKeySet", () => {
  it("manual/osrm/api いずれの既存も保護キーに含める", () => {
    const existing: ExistingTravelTime[] = [
      { fromNodeId: "a", toNodeId: "b", mode: "car", source: "manual" },
      { fromNodeId: "a", toNodeId: "b", mode: "transit", source: "api" },
    ];
    const s = buildSkipKeySet(existing);
    expect(s.has("a>b>car")).toBe(true);
    expect(s.has("a>b>transit")).toBe(true);
    expect(s.has("b>a>car")).toBe(false);
  });
});

describe("buildCarUpserts", () => {
  const nodes = [A, B, V];
  const durations = parseOsrmDurations({
    code: "Ok",
    durations: [[0, 600, 300], [600, 0, 360], [300, 360, 0]],
  });
  it("未入力 car ペアのみ source=osrm で埋める", () => {
    const skip = buildSkipKeySet([
      { fromNodeId: "a", toNodeId: "b", mode: "car", source: "manual" },
    ]);
    const out = buildCarUpserts(nodes, durations, skip);
    // 6 ペア中 a>b を除く 5
    expect(out).toHaveLength(5);
    expect(out.every((u) => u.source === "osrm" && u.mode === "car")).toBe(true);
    expect(out.find((u) => u.fromNodeId === "a" && u.toNodeId === "b")).toBeUndefined();
    const av = out.find((u) => u.fromNodeId === "a" && u.toNodeId === "v");
    expect(av?.minutes).toBe(5); // 300s
  });

  it("異常値（minutes>600）のエントリは保存しない（1093 分は除外）", () => {
    const sane = parseOsrmDurations({
      code: "Ok",
      // a>b = 1093 分 = 65580 秒（座標エラー由来の異常値）, a>v = 5 分。
      durations: [
        [0, 1093 * 60, 300],
        [600, 0, 360],
        [300, 360, 0],
      ],
    });
    const out = buildCarUpserts(nodes, sane, new Set());
    // a>b は 1093 > CAR_MAX_SANE_MIN(600) なので除外される。
    expect(out.find((u) => u.fromNodeId === "a" && u.toNodeId === "b")).toBeUndefined();
    // 他の正常ペアは残る。
    expect(out.find((u) => u.fromNodeId === "a" && u.toNodeId === "v")?.minutes).toBe(5);
    expect(out.every((u) => u.minutes <= CAR_MAX_SANE_MIN)).toBe(true);
  });
});

describe("buildTransitUpserts", () => {
  it("未入力 transit ペアのみ source=api で全順序対を埋める（近接ノード）", () => {
    // V は A 近傍なので A↔V / B↔V は 480 以下に収まる（over-cap スキップなし）。
    const near: GeoNode = { id: "near", lat: 35.69, lng: 139.69 }; // A のすぐ近く
    const nodes = [A, near, V];
    const skip = buildSkipKeySet([
      { fromNodeId: "a", toNodeId: "near", mode: "transit", source: "manual" },
    ]);
    const { upserts, skippedOverCap } = buildTransitUpserts(nodes, skip);
    // 3 ノード順序対 6 - 1(保護) = 5、いずれも近距離で over-cap なし。
    expect(upserts).toHaveLength(5);
    expect(upserts.every((u) => u.source === "api" && u.mode === "transit")).toBe(true);
    expect(skippedOverCap).toBe(0);
  });

  it("推定分が 480 を超えるペアはクランプ値を保存せずスキップ（skippedOverCap で報告）", () => {
    // A(新宿)↔B(横浜) はクランプ廃止で約541分 → 480超 → 両方向スキップ。
    const nodes = [A, B, V];
    const { upserts, skippedOverCap } = buildTransitUpserts(nodes, new Set());
    // 保存された分はすべて 480 以下（クランプ値 480 は混入しない）。
    expect(upserts.every((u) => u.minutes <= TRANSIT_MAX_SANE_MIN)).toBe(true);
    expect(upserts.some((u) => u.minutes === TRANSIT_MAX_SANE_MIN)).toBe(false);
    // a↔b（2ペア）はスキップ、a↔v / b↔v（4ペア）は保存。
    expect(skippedOverCap).toBe(2);
    expect(upserts).toHaveLength(4);
    expect(
      upserts.find((u) => u.fromNodeId === "a" && u.toNodeId === "b"),
    ).toBeUndefined();
  });

  it("car 所要があるペアは car ベース推定を第一情報源にする", () => {
    const meguro: GeoNode = { id: "meguro", lat: 35.633, lng: 139.716 };
    const nerima: GeoNode = { id: "nerima", lat: 35.748, lng: 139.654 };
    const nodes = [meguro, nerima];
    // 目黒→練馬 の car 22 分。transit は car ベースの 50 分になる。
    const carMinutesByPair = new Map<string, number>([["meguro>nerima", 22]]);
    const { upserts } = buildTransitUpserts(nodes, new Set(), undefined, carMinutesByPair);
    const mn = upserts.find((u) => u.fromNodeId === "meguro" && u.toNodeId === "nerima");
    expect(mn?.minutes).toBe(50);
    // 逆方向は car 不在 → haversine fallback（car ベースの 50 とは独立）。
    const nm = upserts.find((u) => u.fromNodeId === "nerima" && u.toNodeId === "meguro");
    expect(nm?.minutes).toBe(estimateTransitMinutes(nerima, meguro));
  });
});

describe("sanitizeGeoNodes", () => {
  it("日本ドメイン内ノードは ok に残る", () => {
    const n: GeoNode = { id: "ok1", lat: 35.6, lng: 139.7 };
    const { ok, dropped } = sanitizeGeoNodes([n]);
    expect(ok).toEqual([{ id: "ok1", lat: 35.6, lng: 139.7 }]);
    expect(dropped).toEqual([]);
  });
  it("swap されたノード（lat=139.7,lng=35.6）は補正して ok に入る", () => {
    const n: GeoNode = { id: "sw1", lat: 139.7, lng: 35.6 };
    const { ok, dropped } = sanitizeGeoNodes([n]);
    expect(ok).toEqual([{ id: "sw1", lat: 35.6, lng: 139.7 }]);
    expect(dropped).toEqual([]);
  });
  it("国外ノード（lat=10,lng=10）は dropped に入る", () => {
    const n: GeoNode = { id: "bad1", lat: 10, lng: 10 };
    const { ok, dropped } = sanitizeGeoNodes([n]);
    expect(ok).toEqual([]);
    expect(dropped).toEqual([{ id: "bad1", lat: 10, lng: 10 }]);
  });
  it("混在集合を ok/dropped に振り分ける", () => {
    const nodes: GeoNode[] = [
      { id: "ok1", lat: 35.6, lng: 139.7 },
      { id: "sw1", lat: 139.7, lng: 35.6 },
      { id: "bad1", lat: 10, lng: 10 },
    ];
    const { ok, dropped } = sanitizeGeoNodes(nodes);
    expect(ok.map((n) => n.id).sort()).toEqual(["ok1", "sw1"]);
    expect(dropped.map((n) => n.id)).toEqual(["bad1"]);
  });
});

describe("buildAutoUpserts", () => {
  it("car(osrm)+transit(api) を未入力ペアのみで合成する", () => {
    const nodes = [A, B];
    const durations = parseOsrmDurations({ code: "Ok", durations: [[0, 600], [600, 0]] });
    const existing: ExistingTravelTime[] = [
      { fromNodeId: "a", toNodeId: "b", mode: "car", source: "manual" }, // 保護
    ];
    const { car, transit, all, transitSkippedOverCap } = buildAutoUpserts(
      nodes,
      durations,
      existing,
    );
    // car: a>b 保護 → b>a のみ
    expect(car.map((u) => `${u.fromNodeId}${u.toNodeId}`)).toEqual(["ba"]);
    // transit: a>b, b>a 両方未入力
    expect(transit).toHaveLength(2);
    expect(all).toHaveLength(3);
    expect(transitSkippedOverCap).toBe(0);
  });

  it("目黒→練馬: car 22 分があれば transit は car ベースの 50 分（248 でも >100 でもない）", () => {
    const meguro: GeoNode = { id: "meguro", lat: 35.633, lng: 139.716 };
    const nerima: GeoNode = { id: "nerima", lat: 35.748, lng: 139.654 };
    const nodes = [meguro, nerima];
    // durations: meguro(0)→nerima(1) = 22 分（= 1320 秒）。
    const durations = parseOsrmDurations({
      code: "Ok",
      durations: [
        [0, 22 * 60],
        [22 * 60, 0],
      ],
    });
    const { transit } = buildAutoUpserts(nodes, durations, []);
    const mn = transit.find((u) => u.fromNodeId === "meguro" && u.toNodeId === "nerima");
    expect(mn?.minutes).toBe(50);
    expect(mn!.minutes).toBeLessThanOrEqual(100);
    expect(mn?.minutes).not.toBe(248);
  });

  it("car 不在ペア: transit は haversine 推定（現行係数）にフォールバック", () => {
    const meguro: GeoNode = { id: "meguro", lat: 35.633, lng: 139.716 };
    const nerima: GeoNode = { id: "nerima", lat: 35.748, lng: 139.654 };
    const nodes = [meguro, nerima];
    // durations 空 → car なし → haversine 推定そのまま。
    const { car, transit } = buildAutoUpserts(nodes, [], []);
    expect(car).toHaveLength(0);
    const mn = transit.find((u) => u.fromNodeId === "meguro" && u.toNodeId === "nerima");
    expect(mn?.minutes).toBe(estimateTransitMinutes(meguro, nerima));
  });

  it("over-cap スキップ: car 不在の遠距離（>480分）は保存されず transitSkippedOverCap≥1", () => {
    const tokyo: GeoNode = { id: "tokyo", lat: 35.6, lng: 139.7 };
    const okinawa: GeoNode = { id: "okinawa", lat: 26.0, lng: 127.0 };
    const nodes = [tokyo, okinawa];
    // car 不在（durations 空）→ haversine 推定が 480 を超える → ペアごとスキップ。
    const { transit, transitSkippedOverCap } = buildAutoUpserts(nodes, [], []);
    // 当該ペアは transit に存在しない。
    expect(
      transit.find((u) => u.fromNodeId === "tokyo" && u.toNodeId === "okinawa"),
    ).toBeUndefined();
    expect(transitSkippedOverCap).toBeGreaterThanOrEqual(1);
    // クランプ値 480 は一切保存されない。
    expect(transit.some((u) => u.minutes === TRANSIT_MAX_SANE_MIN)).toBe(false);
  });

  it("異常な car 所要（1093分）は transit ベースに使わず haversine fallback に回す", () => {
    const meguro: GeoNode = { id: "meguro", lat: 35.633, lng: 139.716 };
    const nerima: GeoNode = { id: "nerima", lat: 35.748, lng: 139.654 };
    const nodes = [meguro, nerima];
    // meguro→nerima の car = 1093 分（CAR_MAX_SANE_MIN 超の異常値）。
    const durations = parseOsrmDurations({
      code: "Ok",
      durations: [
        [0, 1093 * 60],
        [1093 * 60, 0],
      ],
    });
    const { transit } = buildAutoUpserts(nodes, durations, []);
    const mn = transit.find((u) => u.fromNodeId === "meguro" && u.toNodeId === "nerima");
    // 1093 を car ベース（= 1093*1.6+15 = 1764）に使っていない。
    // 都内近接距離なので haversine fallback 値で保存される。
    expect(mn?.minutes).toBe(estimateTransitMinutes(meguro, nerima));
    expect(mn?.minutes).not.toBe(estimateTransitFromCarMinutes(1093));
  });
});

describe("buildRouteTimesToVenue", () => {
  it("各ノード→会場の car 所要を minutesToVenue にする（会場自身は除外）", () => {
    const nodes = [A, B, V]; // venue index 2
    const durations = parseOsrmDurations({
      code: "Ok",
      durations: [[0, 600, 1200], [600, 0, 900], [1200, 900, 0]],
    });
    const out = buildRouteTimesToVenue(nodes, 2, durations);
    expect(out).toEqual([
      { nodeId: "a", minutesToVenue: 20 }, // a>v 1200s
      { nodeId: "b", minutesToVenue: 15 }, // b>v 900s
    ]);
  });
  it("venueIndex 不正は空", () => {
    expect(buildRouteTimesToVenue([A], -1, [])).toEqual([]);
  });
});

describe("fetchOsrmTable (fetch mocked)", () => {
  it("durations を取得して分に変換する", async () => {
    const fetchImpl: FetchLike = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ code: "Ok", durations: [[0, 600], [600, 0]] }),
      }),
    );
    const out = await fetchOsrmTable([A, B], { fetchImpl, timeoutMs: 1000 });
    expect(out).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("ノードが2未満なら外部を叩かず空", async () => {
    const fetchImpl: FetchLike = vi.fn();
    expect(await fetchOsrmTable([A], { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("失敗は隔離して空配列（日本語案内フォールバック用）", async () => {
    const fetchImpl: FetchLike = vi.fn(() => Promise.reject(new Error("timeout")));
    expect(await fetchOsrmTable([A, B], { fetchImpl, timeoutMs: 1000 })).toEqual([]);
  });
  it("UA を明示する", async () => {
    const fetchImpl: FetchLike = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ code: "Ok", durations: [[0, 1], [1, 0]] }) }),
    );
    await fetchOsrmTable([A, B], { fetchImpl, timeoutMs: 1000 });
    const init = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(init.headers["User-Agent"]).toContain("trails.jp");
  });
});
