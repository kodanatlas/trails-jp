import { describe, it, expect } from "vitest";
import { competitorPageUrl, officialCompetitorUrl } from "../official-link";
import type { OringenEntry, OringenPerson } from "../types";

const RESULT_URL = "https://resultat.oringen.se/2026";

function entry(over: Partial<OringenEntry> = {}): OringenEntry {
  return {
    className: "H40",
    startTime: null,
    place: null,
    time: null,
    distanceM: null,
    competitorId: 2297,
    ...over,
  };
}

function person(entries: OringenPerson["entries"], name = "Kodama Takeshi"): OringenPerson {
  return { name, kanji: null, kanjiConfidence: null, club: "Irumashi OLC", entries };
}

describe("competitorPageUrl", () => {
  it("公式選手ページの URL を組む（児玉健=2297 の実 URL 形式）", () => {
    expect(competitorPageUrl(RESULT_URL, 2297)).toBe(
      "https://resultat.oringen.se/2026/competitors/2297",
    );
  });
});

describe("officialCompetitorUrl", () => {
  it("5日間クラス（全日同一 ID）は選手ページへ直接", () => {
    const p = person({
      "1": [entry()],
      "2": [entry()],
      "5": [entry()],
    });
    expect(officialCompetitorUrl(p, RESULT_URL)).toBe(
      "https://resultat.oringen.se/2026/competitors/2297",
    );
  });

  it("Etappstart（日ごとに別 ID）は公式の氏名検索へ", () => {
    const p = person(
      {
        "1": [entry({ className: "Etappstart Gul 2,5", competitorId: 2944 })],
        "2": [entry({ className: "Etappstart Gul 3,5", competitorId: 2945 })],
      },
      "Kojima Masako",
    );
    expect(officialCompetitorUrl(p, RESULT_URL)).toBe(
      "https://resultat.oringen.se/2026/competitors?q=Kojima%20Masako",
    );
  });

  it("複数クラス出場（クラスごとに別 ID）も氏名検索へ", () => {
    const p = person({
      "1": [entry({ competitorId: 4438 }), entry({ className: "Pre-Elit", competitorId: 613785 })],
    });
    expect(officialCompetitorUrl(p, RESULT_URL)).toBe(
      "https://resultat.oringen.se/2026/competitors?q=Kodama%20Takeshi",
    );
  });

  it("ID が1つも無い（competitorId 追加前の旧データ）なら null", () => {
    const p = person({ "1": [entry({ competitorId: null })], "2": [entry({ competitorId: undefined })] });
    expect(officialCompetitorUrl(p, RESULT_URL)).toBeNull();
  });

  it("一部欠落でも残った ID が1つなら直接リンク", () => {
    const p = person({
      "1": [entry({ competitorId: null })],
      "2": [entry()],
    });
    expect(officialCompetitorUrl(p, RESULT_URL)).toBe(
      "https://resultat.oringen.se/2026/competitors/2297",
    );
  });
});
