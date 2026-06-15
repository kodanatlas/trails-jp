import { describe, it, expect, vi } from "vitest";
import {
  normalizeGeocodeQuery,
  withStationSuffix,
  buildGeocodeQueries,
  pickFirstLatLng,
  pickBestLatLng,
  pickBestCandidate,
  centroidLatLng,
  geocodeAddress,
  geocodeAddressDetailed,
  isJapanDomain,
  normalizeJapanLatLng,
  TOKYO_STATION,
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

describe("pickBestLatLng", () => {
  // 北海道目黒（遠地）を FIRST に置き、先頭採用が死んでいることを証明する。
  it("目黒駅 regression: 先頭の北海道候補ではなく東京の目黒駅を採る", () => {
    const features = [
      { geometry: { coordinates: [143.25, 42.13] }, properties: { title: "北海道広尾郡大樹町字目黒" } },
      { geometry: { coordinates: [139.716, 35.633] }, properties: { title: "目黒駅" } },
    ];
    expect(pickBestLatLng(features, TOKYO_STATION, "目黒駅")).toEqual({ lat: 35.633, lng: 139.716 });
  });

  it("駅優先: 近い非駅(~2km)より、やや遠い駅(~10km, <300km)を優先する", () => {
    // ref=東京駅。非駅 "目黒" は東京駅のすぐ近く、駅 "目黒駅" はやや南で両方 300km 以内。
    const features = [
      { geometry: { coordinates: [139.767, 35.70] }, properties: { title: "目黒" } }, // 非駅・~2km
      { geometry: { coordinates: [139.716, 35.633] }, properties: { title: "目黒駅" } }, // 駅・~10km
    ];
    expect(pickBestLatLng(features, TOKYO_STATION, "目黒駅")).toEqual({ lat: 35.633, lng: 139.716 });
  });

  it("駅候補が300km超のみ: 駅優先で絞らず、近い非駅候補を採る", () => {
    // 駅候補は北海道（300km超）のみ。非駅候補は東京近傍。駅優先で絞ると遠地を掴むため絞らない。
    const features = [
      { geometry: { coordinates: [143.25, 42.13] }, properties: { title: "目黒駅" } }, // 駅だが北海道
      { geometry: { coordinates: [139.716, 35.633] }, properties: { title: "目黒" } }, // 非駅・東京
    ];
    expect(pickBestLatLng(features, TOKYO_STATION, "目黒駅")).toEqual({ lat: 35.633, lng: 139.716 });
  });

  it("中目黒駅 regression: 近接の中目黒駅でなく完全一致の目黒駅を採る", () => {
    // GSI が "目黒駅" に対し中目黒駅(上位)と目黒駅を両方返す実ケース。両者とも都内で近接。
    const features = [
      { geometry: { coordinates: [139.699218, 35.644236] }, properties: { title: "中目黒駅" } },
      { geometry: { coordinates: [139.716091, 35.632862] }, properties: { title: "目黒駅" } },
    ];
    expect(pickBestLatLng(features, TOKYO_STATION, "目黒駅")).toEqual({ lat: 35.632862, lng: 139.716091 });
  });

  it("非駅クエリは純粋に最近傍（タイトル無関係）", () => {
    const features = [
      { geometry: { coordinates: [143.25, 42.13] }, properties: { title: "昭和記念公園(北海道)" } },
      { geometry: { coordinates: [139.41, 35.70] }, properties: { title: "昭和記念公園" } },
    ];
    expect(pickBestLatLng(features, TOKYO_STATION, "昭和記念公園")).toEqual({ lat: 35.70, lng: 139.41 });
  });

  it("全候補が300km超でも null を返さず最近傍を採る（遠征大会の会場登録を阻害しない）", () => {
    const features = [
      { geometry: { coordinates: [143.25, 42.13] }, properties: { title: "帯広A" } }, // 東京駅から 777km
      { geometry: { coordinates: [141.35, 43.06] }, properties: { title: "札幌B" } }, // 東京駅から 832km
    ];
    // どちらも 300km 超だが null にせず、最近傍（帯広A）を採る。
    expect(pickBestLatLng(features, TOKYO_STATION, "帯広")).toEqual({ lat: 42.13, lng: 143.25 });
  });

  it("候補正規化: swap された対 [35.6,139.7] と国外 [10,10] は drop され、有効候補が残る", () => {
    // [35.6,139.7] は coords=[lng=35.6, lat=139.7]。lat=139.7 が第1ゲート(isValidLat)で弾かれ drop
    //   （Japan の経度 122-154 は常に緯度上限90を超えるため、GSI の [lng,lat] 順では swap 補正は実質
    //    到達不能＝pickFirstLatLng と同じ挙動）。[10,10] は国外で normalizeJapanLatLng が null → drop。
    // 残る有効候補（東京）が返る。
    const features = [
      { geometry: { coordinates: [35.6, 139.7] }, properties: { title: "swap地点(drop)" } },
      { geometry: { coordinates: [10, 10] }, properties: { title: "国外(drop)" } },
      { geometry: { coordinates: [139.767, 35.681] }, properties: { title: "東京" } },
    ];
    expect(pickBestLatLng(features, TOKYO_STATION, "swap地点")).toEqual({ lat: 35.681, lng: 139.767 });
  });

  it("有効候補ゼロは null", () => {
    expect(pickBestLatLng([], TOKYO_STATION, "x")).toBeNull();
    expect(pickBestLatLng([{ geometry: { coordinates: [10, 10] } }], TOKYO_STATION, "x")).toBeNull();
  });
});

describe("centroidLatLng", () => {
  it("2 点の算術平均を返す", () => {
    expect(centroidLatLng([{ lat: 35, lng: 139 }, { lat: 37, lng: 141 }])).toEqual({ lat: 36, lng: 140 });
  });
  it("空配列は null", () => {
    expect(centroidLatLng([])).toBeNull();
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

  it("ref で同名異地の最近傍を選ぶ（同一レスポンスでも ref 次第で結果が変わる）", async () => {
    // 同名異地: 北海道目黒(先頭) と 東京の目黒駅。レスポンスは両ケースで同一。
    const meguroFeatures = [
      { geometry: { coordinates: [143.25, 42.13] }, properties: { title: "北海道広尾郡大樹町字目黒" } },
      { geometry: { coordinates: [139.716, 35.633] }, properties: { title: "目黒駅" } },
    ];
    const mkFetch = (): FetchLike => vi.fn(() => okJson(meguroFeatures));

    // ref を北海道近傍に置くと北海道候補を採る。
    const near = await geocodeAddress("目黒駅", {
      fetchImpl: mkFetch(),
      timeoutMs: 1000,
      ref: { lat: 42.9, lng: 143.2 },
    });
    expect(near).toEqual({ lat: 42.13, lng: 143.25 });

    // ref 未指定（既定=東京駅）だと東京の目黒駅を採る。
    const def = await geocodeAddress("目黒駅", { fetchImpl: mkFetch(), timeoutMs: 1000 });
    expect(def).toEqual({ lat: 35.633, lng: 139.716 });
  });
});

describe("pickBestCandidate", () => {
  it("pickBestLatLng と同じ座標を返し、title と exact を付与する", () => {
    // 完全一致（入力 "目黒駅" → 解決 "目黒駅"）。
    const features = [
      { geometry: { coordinates: [139.699218, 35.644236] }, properties: { title: "中目黒駅" } },
      { geometry: { coordinates: [139.716091, 35.632862] }, properties: { title: "目黒駅" } },
    ];
    const r = pickBestCandidate(features, TOKYO_STATION, "目黒駅");
    expect(r).toEqual({ lat: 35.632862, lng: 139.716091, title: "目黒駅", exact: true });
    // pickBestLatLng は同じ座標（後方互換ラッパ）。
    expect(pickBestLatLng(features, TOKYO_STATION, "目黒駅")).toEqual({
      lat: 35.632862,
      lng: 139.716091,
    });
  });

  it("入力名と解決先が異なるとき exact=false（目黒駅→中目黒駅の誤解決）", () => {
    // 完全一致候補（目黒駅）が無く、中目黒駅だけが返る同名近接の誤解決ケース。
    const features = [
      { geometry: { coordinates: [139.699218, 35.644236] }, properties: { title: "中目黒駅" } },
    ];
    const r = pickBestCandidate(features, TOKYO_STATION, "目黒駅");
    expect(r).toEqual({ lat: 35.644236, lng: 139.699218, title: "中目黒駅", exact: false });
  });

  it("exact は空白・全角半角を無視して判定（compactForMatch 規約）", () => {
    const features = [
      { geometry: { coordinates: [139.31, 35.65] }, properties: { title: "八王子駅" } },
    ];
    // 入力 "八王子 駅"（空白入り）でも解決先 "八王子駅" と完全一致扱い。
    const r = pickBestCandidate(features, TOKYO_STATION, "八王子 駅");
    expect(r?.exact).toBe(true);
    expect(r?.title).toBe("八王子駅");
  });

  it("title が空（properties 無し）でも落ちず exact=false で返す", () => {
    const features = [{ geometry: { coordinates: [139.767, 35.681] } }];
    const r = pickBestCandidate(features, TOKYO_STATION, "東京駅");
    expect(r).toEqual({ lat: 35.681, lng: 139.767, title: "", exact: false });
  });

  it("有効候補ゼロは null", () => {
    expect(pickBestCandidate([], TOKYO_STATION, "x")).toBeNull();
    expect(
      pickBestCandidate([{ geometry: { coordinates: [10, 10] } }], TOKYO_STATION, "x"),
    ).toBeNull();
  });
});

describe("geocodeAddressDetailed (fetch mocked)", () => {
  const okJson = (features: unknown): ReturnType<FetchLike> =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(features) });

  it("座標 + title + exact を返す（完全一致は exact=true）", async () => {
    const fetchImpl: FetchLike = vi.fn(() =>
      okJson([{ geometry: { coordinates: [139.31, 35.65] }, properties: { title: "八王子駅" } }]),
    );
    const r = await geocodeAddressDetailed("八王子駅", { fetchImpl, timeoutMs: 1000 });
    expect(r).toEqual({ lat: 35.65, lng: 139.31, title: "八王子駅", exact: true });
  });

  it("同名近接の誤解決は exact=false（目黒駅→中目黒駅のみ返るケース）", async () => {
    const fetchImpl: FetchLike = vi.fn(() =>
      okJson([
        { geometry: { coordinates: [139.699218, 35.644236] }, properties: { title: "中目黒駅" } },
      ]),
    );
    const r = await geocodeAddressDetailed("目黒駅", { fetchImpl, timeoutMs: 1000 });
    expect(r).toEqual({ lat: 35.644236, lng: 139.699218, title: "中目黒駅", exact: false });
  });

  it("駅サフィックス再試行で命中した場合 exact はその命中クエリ基準（八王子→八王子駅で exact=true）", async () => {
    const fetchImpl: FetchLike = vi.fn((url: string) => {
      // 1回目（"八王子"）は空、2回目（"八王子駅"）で "八王子駅" 命中。
      if (url.includes("%E9%A7%85")) {
        return okJson([
          { geometry: { coordinates: [139.31, 35.65] }, properties: { title: "八王子駅" } },
        ]);
      }
      return okJson([]);
    });
    const r = await geocodeAddressDetailed("八王子", { fetchImpl, timeoutMs: 1000 });
    expect(r).toEqual({ lat: 35.65, lng: 139.31, title: "八王子駅", exact: true });
  });

  it("空入力は外部を叩かず null", async () => {
    const fetchImpl: FetchLike = vi.fn(() => okJson([]));
    const r = await geocodeAddressDetailed("  ", { fetchImpl });
    expect(r).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ネットワーク失敗は隔離して null", async () => {
    const fetchImpl: FetchLike = vi.fn(() => Promise.reject(new Error("boom")));
    const r = await geocodeAddressDetailed("八王子駅", { fetchImpl, timeoutMs: 1000 });
    expect(r).toBeNull();
  });

  it("geocodeAddress は geocodeAddressDetailed の座標だけを返す（後方互換）", async () => {
    const features = [
      { geometry: { coordinates: [139.31, 35.65] }, properties: { title: "八王子駅" } },
    ];
    const mk = (): FetchLike => vi.fn(() => okJson(features));
    const detailed = await geocodeAddressDetailed("八王子駅", { fetchImpl: mk(), timeoutMs: 1000 });
    const plain = await geocodeAddress("八王子駅", { fetchImpl: mk(), timeoutMs: 1000 });
    expect(plain).toEqual({ lat: detailed!.lat, lng: detailed!.lng });
  });
});
