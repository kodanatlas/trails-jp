import { describe, it, expect, vi } from "vitest";
import {
  shouldGeocodeNodeKind,
  hasUsableStoreCoords,
  resolveVenueCoords,
  resolveVenueCoordsWithScrape,
  type ScrapeCoordsFn,
} from "../venue-coords";

describe("shouldGeocodeNodeKind", () => {
  it("venue は名前ジオコーディングしない（false）", () => {
    expect(shouldGeocodeNodeKind("venue")).toBe(false);
  });
  it("area / pickup は従来どおり名前ジオコーディングする（true）", () => {
    expect(shouldGeocodeNodeKind("area")).toBe(true);
    expect(shouldGeocodeNodeKind("pickup")).toBe(true);
  });
  it("未知の kind も true（venue 以外は許可）", () => {
    expect(shouldGeocodeNodeKind("something")).toBe(true);
  });
});

describe("hasUsableStoreCoords", () => {
  it("有限の数値ペアは true", () => {
    expect(hasUsableStoreCoords(35.59, 138.58)).toBe(true);
    expect(hasUsableStoreCoords(0, 0)).toBe(true);
  });
  it("null / undefined は false", () => {
    expect(hasUsableStoreCoords(null, 138.58)).toBe(false);
    expect(hasUsableStoreCoords(35.59, null)).toBe(false);
    expect(hasUsableStoreCoords(undefined, undefined)).toBe(false);
  });
  it("NaN / Infinity は false", () => {
    expect(hasUsableStoreCoords(NaN, 138.58)).toBe(false);
    expect(hasUsableStoreCoords(35.59, Infinity)).toBe(false);
  });
  it("非数値（文字列）は false", () => {
    expect(hasUsableStoreCoords("35.59", "138.58")).toBe(false);
  });
});

describe("resolveVenueCoords（store座標 → scrape → null の優先順位）", () => {
  it("store 座標が有効ならそれを採用（scrape 結果があっても store 優先）", () => {
    const r = resolveVenueCoords({ lat: 35.7, lng: 139.7 }, { lat: 35.59, lng: 138.58 });
    expect(r).toEqual({ lat: 35.7, lng: 139.7, source: "store" });
  });
  it("store が null なら scrape 結果を採用", () => {
    const r = resolveVenueCoords({ lat: null, lng: null }, { lat: 35.5905, lng: 138.5839 });
    expect(r).toEqual({ lat: 35.5905, lng: 138.5839, source: "scrape" });
  });
  it("store も scrape も無ければ座標なし（none）", () => {
    expect(resolveVenueCoords({ lat: null, lng: null }, null)).toEqual({
      lat: null,
      lng: null,
      source: "none",
    });
  });
  it("store の片側だけ数値なら無効扱い→scrape へ", () => {
    const r = resolveVenueCoords({ lat: 35.7, lng: null }, { lat: 35.59, lng: 138.58 });
    expect(r).toEqual({ lat: 35.59, lng: 138.58, source: "scrape" });
  });
});

describe("resolveVenueCoordsWithScrape（events POST の座標決定・scrape をモック）", () => {
  it("store 座標が有効なら scrape を呼ばずに store を採用", async () => {
    const scrape = vi.fn<ScrapeCoordsFn>(() => Promise.resolve({ lat: 35.59, lng: 138.58 }));
    const r = await resolveVenueCoordsWithScrape(
      { lat: 35.7, lng: 139.7 },
      "https://japan-o-entry.com/event/view/2448",
      scrape,
    );
    expect(r).toEqual({ lat: 35.7, lng: 139.7, source: "store" });
    expect(scrape).not.toHaveBeenCalled();
  });

  it("store が null かつ joe_url ありなら scrape の JOY ピンを採用（曽根丘陵公園 regression）", async () => {
    // 名前ジオコーディングだと 35.664,138.568（約8kmずれ）。JOY ピンは 35.5905,138.5839 が正。
    const scrape = vi.fn<ScrapeCoordsFn>(() => Promise.resolve({ lat: 35.5905, lng: 138.5839 }));
    const r = await resolveVenueCoordsWithScrape(
      { lat: null, lng: null },
      "https://japan-o-entry.com/event/view/2448",
      scrape,
    );
    expect(r).toEqual({ lat: 35.5905, lng: 138.5839, source: "scrape" });
    expect(scrape).toHaveBeenCalledExactlyOnceWith(
      "https://japan-o-entry.com/event/view/2448",
    );
  });

  it("store が null かつ joe_url 無しなら scrape せず座標なし", async () => {
    const scrape = vi.fn<ScrapeCoordsFn>(() => Promise.resolve({ lat: 1, lng: 1 }));
    const r = await resolveVenueCoordsWithScrape({ lat: null, lng: null }, null, scrape);
    expect(r).toEqual({ lat: null, lng: null, source: "none" });
    expect(scrape).not.toHaveBeenCalled();
  });

  it("scrape が null（JOY にピン無し）なら座標なし", async () => {
    const scrape = vi.fn<ScrapeCoordsFn>(() => Promise.resolve(null));
    const r = await resolveVenueCoordsWithScrape(
      { lat: null, lng: null },
      "https://japan-o-entry.com/event/view/9999",
      scrape,
    );
    expect(r).toEqual({ lat: null, lng: null, source: "none" });
  });

  it("scrape が例外を投げても隔離して座標なし（イベント作成は壊さない）", async () => {
    const scrape = vi.fn<ScrapeCoordsFn>(() => Promise.reject(new Error("timeout")));
    const r = await resolveVenueCoordsWithScrape(
      { lat: null, lng: null },
      "https://japan-o-entry.com/event/view/2448",
      scrape,
    );
    expect(r).toEqual({ lat: null, lng: null, source: "none" });
  });
});
