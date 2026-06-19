import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DOKORI_ID_BASE,
  DOKORI_EVENTS,
  isDokoriEventId,
  getDokoriRef,
  getDokoriPublicId,
  reconstructFlight,
  parseDokoriEntryList,
  parseDokoriEvents,
} from "../dokori";
import type { EntryListResult } from "../entries";

const html = readFileSync(
  fileURLToPath(new URL("./fixtures/dokori_tortoise_50th.html", import.meta.url)),
  "utf8",
);

// evt_tortoise_50th: Day1=90000001 / Day2=90000002 / Day3=90000003
const D1 = DOKORI_ID_BASE + 1;
const D2 = DOKORI_ID_BASE + 2;
const D3 = DOKORI_ID_BASE + 3;

const NOW_OPEN = Date.parse("2026-06-15T00:00:00+09:00"); // 締切(9/5)前
const NOW_CLOSED = Date.parse("2026-10-01T00:00:00+09:00"); // 締切後

/** EntryListResult から (name|className) でユニーク化したクラス別人数を出す（複数所属の二重計上を排除）。 */
function byClass(r: EntryListResult): Record<string, number> {
  const seen = new Set<string>();
  const out: Record<string, number> = {};
  for (const t of r.teams) {
    for (const e of t.entries) {
      const k = `${e.name}|${e.className}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out[e.className] = (out[e.className] || 0) + 1;
    }
  }
  return out;
}

describe("dokori registry / id 解決", () => {
  it("ホワイトリストに evt_tortoise_50th が baseEventId=90000001 で登録", () => {
    expect(DOKORI_EVENTS[0]).toEqual({ publicId: "evt_tortoise_50th", baseEventId: D1 });
  });
  it("isDokoriEventId / getDokoriRef が日別IDを解決", () => {
    expect(isDokoriEventId(D1)).toBe(true);
    expect(isDokoriEventId(12345)).toBe(false);
    expect(getDokoriRef(D1)).toMatchObject({ publicId: "evt_tortoise_50th", dayIndex: 0 });
    expect(getDokoriRef(D3)).toMatchObject({ publicId: "evt_tortoise_50th", dayIndex: 2 });
    expect(getDokoriPublicId(D2)).toBe("evt_tortoise_50th");
    expect(getDokoriRef(999)).toBeNull();
  });
});

describe("reconstructFlight", () => {
  it("RSC flight を復元できる", () => {
    expect(reconstructFlight(html).length).toBeGreaterThan(200_000);
  });
});

describe("parseDokoriEvents（日別3イベント展開）", () => {
  const events = parseDokoriEvents(html, "evt_tortoise_50th", D1, NOW_OPEN);

  it("3日 → 3イベント（日付昇順・合成ID連番）", () => {
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.joe_event_id)).toEqual([D1, D2, D3]);
    expect(events.map((e) => e.date)).toEqual(["2026-10-10", "2026-10-11", "2026-10-12"]);
  });

  it("Day1: 予選・富士天神山(鳴沢村)・座標 35.4193/138.7414", () => {
    const d1 = events[0];
    expect(d1.name).toContain("10/10");
    expect(d1.name).toContain("予選");
    expect(d1.prefecture).toBe("山梨県");
    expect(d1.venue).toContain("ふじてん");
    expect(d1.lat).toBeCloseTo(35.4193, 3);
    expect(d1.lng).toBeCloseTo(138.7414, 3);
    expect(d1.entry_status).toBe("open");
    expect(d1.source).toBe("dokori");
    expect(d1.tags).toContain("どこオリ");
    expect(d1.joe_url).toBe("https://www.dokori.net/event/evt_tortoise_50th");
  });

  it("Day2/Day3: 決勝・本栖湖・座標 35.4625/138.6098（Day1と別会場）", () => {
    for (const e of [events[1], events[2]]) {
      expect(e.name).toContain("決勝");
      expect(e.lat).toBeCloseTo(35.4625, 3);
      expect(e.lng).toBeCloseTo(138.6098, 3);
    }
    expect(events[2].event_type).toBe("long"); // Day3 はロング
    expect(events[1].event_type).toBe("middle");
  });

  it("締切後は entry_status=closed", () => {
    const closed = parseDokoriEvents(html, "evt_tortoise_50th", D1, NOW_CLOSED);
    expect(closed.every((e) => e.entry_status === "closed")).toBe(true);
  });
});

describe("parseDokoriEntryList（日別の参加者）", () => {
  it("各日の total（ユニーク人数）: Day1=81 / Day2=80 / Day3=79", () => {
    expect(parseDokoriEntryList(html, D1).total).toBe(81);
    expect(parseDokoriEntryList(html, D2).total).toBe(80);
    expect(parseDokoriEntryList(html, D3).total).toBe(79);
  });

  it("日でクラス内訳が異なる（W50A は Day1 のみ・M50A は 5/4/4・M60A は 8/9/8）", () => {
    const c1 = byClass(parseDokoriEntryList(html, D1));
    const c2 = byClass(parseDokoriEntryList(html, D2));
    const c3 = byClass(parseDokoriEntryList(html, D3));
    expect(c1["W50A"]).toBe(1);
    expect(c2["W50A"]).toBeUndefined();
    expect(c3["W50A"]).toBeUndefined();
    expect([c1["M50A"], c2["M50A"], c3["M50A"]]).toEqual([5, 4, 4]);
    expect([c1["M60A"], c2["M60A"], c3["M60A"]]).toEqual([8, 9, 8]);
    expect(c1["M21A"]).toBe(28);
  });

  it("所属はJOYと同じ正規化（東北大OLC→東北大学）でグループ化", () => {
    const r = parseDokoriEntryList(html, D1);
    const affs = r.teams.map((t) => t.affiliation);
    expect(affs).toContain("東北大学");
    expect(affs).not.toContain("東北大OLC");
    expect(affs).toContain("入間市OLC");
  });
});
