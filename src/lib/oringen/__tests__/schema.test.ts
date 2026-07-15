import { describe, it, expect } from "vitest";
import { oringenDataSchema } from "../schema";

/**
 * スキーマのテスト。特に「生年を持ち込まない」がコードで守られていることを固定する。
 *
 * 2026-07-15、`z.object` + superRefine で生年の混入を検知しようとしたが、z.object が未知キーを
 * **検証前に黙って捨てる**ため素通りしていた（実 HTTP テストで発覚）。strictObject に変更した回帰テスト。
 */

const valid = {
  generatedAt: "2026-07-15T00:00:00Z",
  eventId: 25,
  eventName: "O-Ringen Göteborg",
  resultUrl: "https://resultat.oringen.se/2026",
  races: [{ n: 1, raceId: 124, date: "2026-07-20" }],
  people: [
    {
      name: "Kodama Takeshi",
      kanji: "児玉健",
      kanjiConfidence: "high",
      club: "Irumashi OLC",
      entries: {
        "1": [{ className: "H40", startTime: "10:22", place: null, time: null, distanceM: 6880 }],
      },
    },
  ],
  links: { official: "https://oringen.se", eventor: null, livelox: null, winsplits: null },
};

describe("oringenDataSchema", () => {
  it("正常なペイロードを通す", () => {
    expect(oringenDataSchema.safeParse(valid).success).toBe(true);
  });

  it("生年が混入したら落とす（黙って剥がさない）", () => {
    const withBirthYear = {
      ...valid,
      people: [{ ...valid.people[0], birthYear: 1984 }],
    };
    const r = oringenDataSchema.safeParse(withBirthYear);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain("birthYear");
    }
  });

  it("想定外のキーを落とす（上流の退行を可視化する）", () => {
    const r = oringenDataSchema.safeParse({ ...valid, unexpected: 1 });
    expect(r.success).toBe(false);
  });

  it("startTime が生の日時形式なら落とす（HH:mm へ変換済みであることを強制）", () => {
    const raw = {
      ...valid,
      people: [
        {
          ...valid.people[0],
          entries: {
            "1": [
              { className: "H40", startTime: "2026-07-20T08:22:00", place: null, time: null, distanceM: null },
            ],
          },
        },
      ],
    };
    expect(oringenDataSchema.safeParse(raw).success).toBe(false);
  });

  it("未抽選（startTime=null）は通す", () => {
    const pending = {
      ...valid,
      people: [
        {
          ...valid.people[0],
          entries: { "1": [{ className: "H40", startTime: null, place: null, time: null, distanceM: null }] },
        },
      ],
    };
    expect(oringenDataSchema.safeParse(pending).success).toBe(true);
  });

  it("stage キーが 1-5 以外なら落とす", () => {
    const bad = {
      ...valid,
      people: [{ ...valid.people[0], entries: { "9": [] } }],
    };
    expect(oringenDataSchema.safeParse(bad).success).toBe(false);
  });

  it("generatedAt が ISO8601 でなければ落とす", () => {
    expect(oringenDataSchema.safeParse({ ...valid, generatedAt: "2026-07-15" }).success).toBe(false);
  });
});
