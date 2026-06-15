import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  reconstructFlight,
  parseDokoriEntryList,
  parseDokoriEvent,
} from "../dokori";

const html = readFileSync(
  new URL("./fixtures/dokori_tortoise_50th.html", import.meta.url),
  "utf8",
);

const EVENT_ID = 90000001;

describe("reconstructFlight", () => {
  it("reconstructs a large RSC flight payload", () => {
    const flight = reconstructFlight(html);
    expect(flight.length).toBeGreaterThan(200_000);
  });
});

describe("parseDokoriEntryList", () => {
  const result = parseDokoriEntryList(html, EVENT_ID);

  it("counts 82 unique persons as total", () => {
    expect(result.eventId).toBe(EVENT_ID);
    expect(result.total).toBe(82);
  });

  it("has 82 unique persons across all team entries", () => {
    const names = new Set<string>();
    for (const t of result.teams) {
      for (const e of t.entries) {
        names.add(e.name.normalize("NFKC").replace(/\s+/g, ""));
      }
    }
    expect(names.size).toBe(82);
  });

  it("produces the expected per-class tally", () => {
    const byClass: Record<string, number> = {};
    // Count unique (person, class) pairs to avoid double-count via multi-club groups.
    const seen = new Set<string>();
    for (const t of result.teams) {
      for (const e of t.entries) {
        const key = `${e.name}|${e.className}`;
        if (seen.has(key)) continue;
        seen.add(key);
        byClass[e.className] = (byClass[e.className] ?? 0) + 1;
      }
    }
    expect(byClass["M21A"]).toBe(28);
    expect(byClass["M21E"]).toBe(18);
    expect(byClass["M60A"]).toBe(9);
    expect(byClass["W21E"]).toBe(6);
    expect(byClass["M50A"]).toBe(5);
  });

  it("sorts teams by count descending", () => {
    for (let i = 1; i < result.teams.length; i++) {
      expect(result.teams[i - 1].count).toBeGreaterThanOrEqual(result.teams[i].count);
    }
  });

  it("groups the 9 $undefined clubs under 所属なし", () => {
    const noAff = result.teams.find((t) => t.affiliation === "所属なし");
    expect(noAff).toBeDefined();
    expect(noAff?.count).toBe(9);
  });

  it("includes normalized real affiliations", () => {
    const affs = result.teams.map((t) => t.affiliation);
    // 入間市OLC は名寄せマップに無いのでそのまま残る。
    expect(affs).toContain("入間市OLC");
    // 東北大OLC は splitAffiliations(club-normalize) の universityMap で
    // 東北大学 に正規化される（生文字列 "東北大OLC" は出現しない）。
    expect(affs).toContain("東北大学");
    expect(affs).not.toContain("東北大OLC");
  });
});

describe("parseDokoriEvent", () => {
  const beforeDeadline = Date.parse("2026-06-15T00:00:00+09:00");
  const afterDeadline = Date.parse("2026-10-01T00:00:00+09:00");

  it("extracts event metadata", () => {
    const ev = parseDokoriEvent(html, "evt_tortoise_50th", EVENT_ID, beforeDeadline);
    expect(ev.name).toBe("トータス50周年記念オリエンテーリング大会");
    expect(ev.date).toBe("2026-10-10");
    expect(ev.end_date).toBe("2026-10-12");
    expect(ev.prefecture).toBe("山梨県");
    expect(ev.lat).toBeCloseTo(35.4193, 3);
    expect(ev.lng).toBeCloseTo(138.7414, 3);
    expect(ev.entry_status).toBe("open");
    expect(ev.tags).toContain("どこオリ");
    expect(ev.joe_url).toBe("https://www.dokori.net/event/evt_tortoise_50th");
    expect((ev as { source?: string }).source).toBe("dokori");
  });

  it("reports closed after the deadline", () => {
    const ev = parseDokoriEvent(html, "evt_tortoise_50th", EVENT_ID, afterDeadline);
    expect(ev.entry_status).toBe("closed");
  });
});
