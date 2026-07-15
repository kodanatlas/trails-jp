import { describe, it, expect } from "vitest";
import { toAthleteKey, attachAthleteLinks } from "../athlete-link";
import type { OringenPerson } from "../types";
import athleteIndexJson from "../../../../public/data/athlete-index.json";
import nameMapJson from "@/data/oringen-name-map.json";

const INDEX_KEYS = new Set(Object.keys((athleteIndexJson as { athletes: Record<string, unknown> }).athletes));

function person(name: string, kanji: string | null): OringenPerson {
  return { name, kanji, kanjiConfidence: kanji ? "high" : null, club: "X", entries: {} };
}

describe("toAthleteKey", () => {
  it("空白を除去する（/a/[name]/page.tsx の resolveKey と同じ規則）", () => {
    expect(toAthleteKey("児玉健")).toBe("児玉健");
    expect(toAthleteKey("児玉 健")).toBe("児玉健");
    expect(toAthleteKey("児玉　健")).toBe("児玉健");
  });
});

describe("attachAthleteLinks", () => {
  it("索引にあればキーを付ける", () => {
    const r = attachAthleteLinks([person("Kodama Takeshi", "児玉健")], new Set(["児玉健"]));
    expect(r[0]!.athleteKey).toBe("児玉健");
  });

  it("索引に無ければ null（404 を張らない）", () => {
    const r = attachAthleteLinks([person("Ishii Yuko", "石井祐子")], new Set(["児玉健"]));
    expect(r[0]!.athleteKey).toBeNull();
  });

  it("漢字が無ければ null", () => {
    const r = attachAthleteLinks([person("Suzuki Masao", null)], new Set(["児玉健"]));
    expect(r[0]!.athleteKey).toBeNull();
  });

  it("元の人物データを壊さない（不変）", () => {
    const input = [person("Kodama Takeshi", "児玉健")];
    const r = attachAthleteLinks(input, new Set(["児玉健"]));
    expect(input[0]!.athleteKey).toBeUndefined();
    expect(r[0]!.name).toBe("Kodama Takeshi");
  });
});

describe("実データとの整合", () => {
  it("児玉健の選手ページが実在する", () => {
    expect(INDEX_KEYS.has("児玉健")).toBe(true);
  });

  it("name-map の漢字のうち、索引に無い選手にはリンクを張らない", () => {
    // 2026 実測: 41名中 3名（石井祐子・国沢五月・吉岡春樹）は athlete-index.json に無い。
    // Supabase の athletes(2,418) と athlete-index.json(1,684) が別物なのが原因。
    const people = Object.entries(nameMapJson as Record<string, { kanji: string }>).map(([name, v]) =>
      person(name, v.kanji),
    );
    const linked = attachAthleteLinks(people, INDEX_KEYS);
    const withLink = linked.filter((p) => p.athleteKey);
    const without = linked.filter((p) => !p.athleteKey);

    // リンクを張った全員が索引に実在すること（＝404 を張っていない）
    for (const p of withLink) {
      expect(INDEX_KEYS.has(p.athleteKey!), `${p.name} -> ${p.athleteKey}`).toBe(true);
    }
    // 漢字はあるのにページが無い人が存在する事実を固定する（0 になったら索引が増えた合図）
    expect(withLink.length).toBeGreaterThan(30);
    expect(without.length).toBeGreaterThan(0);
  });
});
