import { describe, it, expect, vi } from "vitest";
import {
  haversineKm,
  estimateTransitMinutes,
  buildOsrmCoordsParam,
  buildOsrmTableUrl,
  parseOsrmDurations,
  buildSkipKeySet,
  buildCarUpserts,
  buildTransitUpserts,
  buildAutoUpserts,
  buildRouteTimesToVenue,
  fetchOsrmTable,
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
});

describe("buildTransitUpserts", () => {
  it("未入力 transit ペアのみ source=api で全順序対を埋める", () => {
    const nodes = [A, B, V];
    const skip = buildSkipKeySet([
      { fromNodeId: "a", toNodeId: "b", mode: "transit", source: "manual" },
    ]);
    const out = buildTransitUpserts(nodes, skip);
    // 3 ノード順序対 6 - 1(保護) = 5
    expect(out).toHaveLength(5);
    expect(out.every((u) => u.source === "api" && u.mode === "transit")).toBe(true);
  });
});

describe("buildAutoUpserts", () => {
  it("car(osrm)+transit(api) を未入力ペアのみで合成する", () => {
    const nodes = [A, B];
    const durations = parseOsrmDurations({ code: "Ok", durations: [[0, 600], [600, 0]] });
    const existing: ExistingTravelTime[] = [
      { fromNodeId: "a", toNodeId: "b", mode: "car", source: "manual" }, // 保護
    ];
    const { car, transit, all } = buildAutoUpserts(nodes, durations, existing);
    // car: a>b 保護 → b>a のみ
    expect(car.map((u) => `${u.fromNodeId}${u.toNodeId}`)).toEqual(["ba"]);
    // transit: a>b, b>a 両方未入力
    expect(transit).toHaveLength(2);
    expect(all).toHaveLength(3);
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
