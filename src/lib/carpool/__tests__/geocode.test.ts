import { describe, it, expect, vi } from "vitest";
import {
  normalizeGeocodeQuery,
  withStationSuffix,
  buildGeocodeQueries,
  pickFirstLatLng,
  geocodeAddress,
  isJapanDomain,
  normalizeJapanLatLng,
  type FetchLike,
} from "../geocode";

describe("normalizeGeocodeQuery", () => {
  it("全角空白を半角化し前後・連続空白を畳む", () => {
    expect(normalizeGeocodeQuery("　八王子　 市 　")).toBe("八王子 市");
  });
  it("空文字/空白のみは空文字", () => {
    expect(normalizeGeocodeQuery("   ")).toBe("");
    expect(normalizeGeocodeQuery("")).toBe("");
  });
});

describe("withStationSuffix", () => {
  it("地物サフィックスが無ければ駅を補う", () => {
    expect(withStationSuffix("八王子")).toBe("八王子駅");
  });
  it("既に駅なら null", () => {
    expect(withStationSuffix("八王子駅")).toBeNull();
  });
  it("他の地物サフィックス（公園・IC）なら null", () => {
    expect(withStationSuffix("昭和記念公園")).toBeNull();
    expect(withStationSuffix("八王子IC")).toBeNull();
  });
  it("空文字は null", () => {
    expect(withStationSuffix("  ")).toBeNull();
  });
});

describe("buildGeocodeQueries", () => {
  it("正規化クエリ → 駅サフィックスの順、重複なし", () => {
    expect(buildGeocodeQueries("八王子")).toEqual(["八王子", "八王子駅"]);
  });
  it("既に駅なら 1 件のみ", () => {
    expect(buildGeocodeQueries("八王子駅")).toEqual(["八王子駅"]);
  });
  it("空入力は空配列", () => {
    expect(buildGeocodeQueries("  ")).toEqual([]);
  });
});

describe("pickFirstLatLng", () => {
  it("GSI の [lng, lat] 順から正しく lat/lng を取り出す", () => {
    const features = [
      { geometry: { coordinates: [139.6917, 35.6895] }, properties: { title: "東京都" } },
    ];
    expect(pickFirstLatLng(features)).toEqual({ lat: 35.6895, lng: 139.6917 });
  });
  it("先頭が無効でも次の有効候補を採る", () => {
    const features = [
      { geometry: { coordinates: ["x", "y"] } },
      { geometry: { coordinates: [139.5, 35.5] } },
    ];
    expect(pickFirstLatLng(features)).toEqual({ lat: 35.5, lng: 139.5 });
  });
  it("範囲外座標は除外", () => {
    const features = [{ geometry: { coordinates: [200, 100] } }];
    expect(pickFirstLatLng(features)).toBeNull();
  });
  it("配列でない/空は null", () => {
    expect(pickFirstLatLng(null)).toBeNull();
    expect(pickFirstLatLng([])).toBeNull();
    expect(pickFirstLatLng({})).toBeNull();
  });
  it("日本ドメイン内の [lng, lat] はそのまま採用する", () => {
    // 目黒駅相当: coords=[139.716, 35.633]（GSI の [lng,lat] 順）。
    const features = [{ geometry: { coordinates: [139.716, 35.633] } }];
    expect(pickFirstLatLng(features)).toEqual({ lat: 35.633, lng: 139.716 });
  });
  it("国外ドメインの候補は棄却して次の有効候補を採る", () => {
    // 1件目は物理的には有効だが日本国外（lng=10,lat=10）→ 棄却。2件目を採る。
    const features = [
      { geometry: { coordinates: [10, 10] } },
      { geometry: { coordinates: [139.6917, 35.6895] } },
    ];
    expect(pickFirstLatLng(features)).toEqual({ lat: 35.6895, lng: 139.6917 });
  });
  it("国外ドメインの候補しか無ければ null", () => {
    const features = [{ geometry: { coordinates: [10, 10] } }];
    expect(pickFirstLatLng(features)).toBeNull();
  });
});

describe("isJapanDomain", () => {
  it("日本国内の緯度経度は true", () => {
    expect(isJapanDomain(35.6895, 139.6917)).toBe(true); // 東京
    expect(isJapanDomain(43.06, 141.35)).toBe(true); // 札幌
  });
  it("緯度経度が入れ替わった対は false（lat=139,lng=35 は範囲外）", () => {
    expect(isJapanDomain(139.7, 35.6)).toBe(false);
  });
  it("国外の対は false", () => {
    expect(isJapanDomain(10, 10)).toBe(false);
    expect(isJapanDomain(51.5, -0.12)).toBe(false); // ロンドン
  });
  it("境界値を含む", () => {
    expect(isJapanDomain(20, 122)).toBe(true);
    expect(isJapanDomain(46, 154)).toBe(true);
    expect(isJapanDomain(19.99, 122)).toBe(false);
    expect(isJapanDomain(46, 154.01)).toBe(false);
  });
});

describe("normalizeJapanLatLng", () => {
  it("日本ドメイン内はそのまま返す", () => {
    expect(normalizeJapanLatLng(35.6, 139.7)).toEqual({ lat: 35.6, lng: 139.7 });
  });
  it("swap された対 (139.7, 35.6) を {lat:35.6,lng:139.7} に自動補正する", () => {
    expect(normalizeJapanLatLng(139.7, 35.6)).toEqual({ lat: 35.6, lng: 139.7 });
  });
  it("国外ドメインの対 (10, 10) は null（棄却）", () => {
    expect(normalizeJapanLatLng(10, 10)).toBeNull();
  });
});

describe("geocodeAddress (fetch mocked)", () => {
  const okJson = (features: unknown): ReturnType<FetchLike> =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(features) });

  it("先頭候補の座標を返す", async () => {
    const fetchImpl: FetchLike = vi.fn(() =>
      okJson([{ geometry: { coordinates: [139.31, 35.65] } }]),
    );
    const r = await geocodeAddress("八王子駅", { fetchImpl, timeoutMs: 1000 });
    expect(r).toEqual({ lat: 35.65, lng: 139.31 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("正規化クエリが空候補なら駅サフィックスで再試行する", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = vi.fn((url: string) => {
      calls.push(url);
      // 1回目（"八王子"）は空、2回目（"八王子駅"）で命中
      if (url.includes("%E9%A7%85")) {
        return okJson([{ geometry: { coordinates: [139.31, 35.65] } }]);
      }
      return okJson([]);
    });
    const r = await geocodeAddress("八王子", { fetchImpl, timeoutMs: 1000 });
    expect(r).toEqual({ lat: 35.65, lng: 139.31 });
    expect(calls).toHaveLength(2);
  });

  it("UA ヘッダを明示して呼ぶ", async () => {
    const fetchImpl: FetchLike = vi.fn(() =>
      okJson([{ geometry: { coordinates: [139, 35] } }]),
    );
    await geocodeAddress("新宿駅", { fetchImpl, timeoutMs: 1000 });
    const init = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(init.headers["User-Agent"]).toContain("trails.jp");
  });

  it("ネットワーク失敗は隔離して null（従来動作維持）", async () => {
    const fetchImpl: FetchLike = vi.fn(() => Promise.reject(new Error("boom")));
    const r = await geocodeAddress("八王子駅", { fetchImpl, timeoutMs: 1000 });
    expect(r).toBeNull();
  });

  it("空入力は外部を叩かず null", async () => {
    const fetchImpl: FetchLike = vi.fn(() => okJson([]));
    const r = await geocodeAddress("  ", { fetchImpl });
    expect(r).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
