import { describe, it, expect } from "vitest";
import { clubDisplay, type ClubInfo } from "../club";
import clubMapJson from "@/data/oringen-club-map.json";
import oringenJson from "@/data/oringen-2026.json";

const MAP = clubMapJson.clubs as Record<string, ClubInfo>;

describe("clubDisplay", () => {
  it.each([
    ["Irumashi OLC", "入間市OLC"],
    ["OLP Hyogo", "OLP兵庫"],
    ["Chiba OLK", "千葉OLK"],
    ["Niigataunv", "新潟大学"],
    ["Shibuya De Hashirukai", "渋谷で走る会"],
    ["OC Tortoise", "トータス"],
    ["Wanderers", "ワンダラーズ"],
    ["Michi", "みちの会"],
    ["Navitabi", "ナビたび"],
    ["Yokohama OL Club", "横浜OLC"],
  ])("%s -> %s", (club, ja) => {
    expect(clubDisplay(club, MAP).ja).toBe(ja);
  });

  it("Tokyo OLC と Tokyo Orienteering Club は同じ東京OLC（O-Ringen 側の表記ゆれ）", () => {
    expect(clubDisplay("Tokyo OLC", MAP).ja).toBe("東京OLC");
    expect(clubDisplay("Tokyo Orienteering Club", MAP).ja).toBe("東京OLC");
  });

  it("臨時チームは日本語名を出さず adhoc で示す（実在しない名前を捏造しない）", () => {
    for (const c of ["Siosio Japan", "OK22"]) {
      const d = clubDisplay(c, MAP);
      expect(d.ja, c).toBeNull();
      expect(d.adhoc, c).toBe(true);
      expect(d.note, c).toBeTruthy();
    }
  });

  it("Torch は日本語名なし・臨時でもない（確証が無いだけ）", () => {
    const d = clubDisplay("Torch", MAP);
    expect(d.ja).toBeNull();
    expect(d.adhoc).toBe(false);
  });

  it("未知のクラブを臨時と決めつけない", () => {
    const d = clubDisplay("Unknown Club", MAP);
    expect(d.ja).toBeNull();
    expect(d.adhoc).toBe(false);
  });
});

describe("実データとの整合", () => {
  it("実データの全19クラブが対応表に載っている（漏れると日本語名が黙って消える）", () => {
    const clubs = new Set(oringenJson.people.map((p: { club: string }) => p.club));
    const missing = [...clubs].filter((c) => !(c in MAP));
    expect(missing, `対応表に無いクラブ: ${missing.join(", ")}`).toEqual([]);
    expect(clubs.size).toBe(19);
  });

  it("日本語名が付くのは実在クラブだけ（臨時チームに日本語名を与えていない）", () => {
    for (const [club, info] of Object.entries(MAP)) {
      if (info.adhoc) expect(info.ja ?? null, club).toBeNull();
    }
  });
});
