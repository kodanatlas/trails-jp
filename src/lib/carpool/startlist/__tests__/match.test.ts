import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { matchStartlistRows, type ExistingMemberRef } from "../match";
import type { StartlistRow } from "../parse";
import { extractStartlistFromPdf } from "../index";
import { normalizeNameKey } from "../../../name-key";

// Windows node / WSL node 両対応のサンプル PDF パス解決（parse.test.ts と同様）。
const SAMPLE_PDF_CANDIDATES = [
  "C:/Users/user/Downloads/orienteering-carpool/docs/spec/samples/startlist_sample_olk2264.pdf",
  "/mnt/c/Users/user/Downloads/orienteering-carpool/docs/spec/samples/startlist_sample_olk2264.pdf",
];
const SAMPLE_PDF = SAMPLE_PDF_CANDIDATES.find((p) => existsSync(p)) ?? SAMPLE_PDF_CANDIDATES[0];

const row = (name: string, affiliation: string, className = "M21A", startTime = "11:00"): StartlistRow => ({
  startTime,
  bib: "1100",
  name,
  affiliation,
  className,
});

describe("matchStartlistRows (フィクスチャ)", () => {
  const joeClubNames = ["入間市OLC"];

  it("クラブ員フィルタ: 入間市OLC 行のみ残し他クラブを除外する", () => {
    const rows = [
      row("猪俣 祐貴", "入間市OLC"),
      row("田中 太郎", "練馬OLC"),
      row("弓田 和生", "入間市OLC/長野県協会"),
    ];
    const matches = matchStartlistRows(rows, joeClubNames, []);
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.rawName)).toEqual(["猪俣 祐貴", "弓田 和生"]);
  });

  it("athleteKey 一致で confidence=exact・memberId セット", () => {
    const rows = [row("猪俣 祐貴", "入間市OLC")];
    const members: ExistingMemberRef[] = [
      { id: "m1", athleteKey: normalizeNameKey("猪俣 祐貴") },
    ];
    const matches = matchStartlistRows(rows, joeClubNames, members);
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe("exact");
    expect(matches[0].memberId).toBe("m1");
  });

  it("displayName フォールバック（全角空白差）で exact", () => {
    // 行氏名「猪俣 祐貴」(半角) vs 登録表示名「猪俣　祐貴」(全角空白) は同一視。
    const rows = [row("猪俣 祐貴", "入間市OLC")];
    const members: ExistingMemberRef[] = [
      { id: "m1", athleteKey: null, displayName: "猪俣　祐貴" },
    ];
    const matches = matchStartlistRows(rows, joeClubNames, members);
    expect(matches[0].confidence).toBe("exact");
    expect(matches[0].memberId).toBe("m1");
  });

  // --- M1: surname はトークン境界の完全一致のみ（prefix 一致は廃止）---

  it("姓の完全一致が一意なら surname（displayName の空白境界から姓を導出）", () => {
    // フルネーム不一致だが姓「猪俣」が一意 → surname。
    const rows = [row("猪俣 祐貴", "入間市OLC")];
    const members: ExistingMemberRef[] = [
      { id: "m1", athleteKey: null, displayName: "猪俣 健太" },
    ];
    const matches = matchStartlistRows(rows, joeClubNames, members);
    expect(matches[0].confidence).toBe("surname");
    expect(matches[0].memberId).toBe("m1");
  });

  it("1文字姓の prefix 誤マッチ回帰: 行「林 太郎」は member「林田 次郎」に一致しない", () => {
    // 旧実装（フルキーの startsWith）では「林」が「林田次郎」の prefix になり surname 誤判定。
    const rows = [row("林 太郎", "入間市OLC")];
    const members: ExistingMemberRef[] = [
      { id: "m1", athleteKey: null, displayName: "林田 次郎" },
    ];
    const matches = matchStartlistRows(rows, joeClubNames, members);
    expect(matches[0].confidence).toBe("none");
    expect(matches[0].memberId).toBeNull();
  });

  it("1文字姓でもトークン境界が一致すれば surname（林 ↔ 林 次郎）", () => {
    const rows = [row("林 太郎", "入間市OLC")];
    const members: ExistingMemberRef[] = [
      { id: "m1", athleteKey: null, displayName: "林 次郎" },
    ];
    const matches = matchStartlistRows(rows, joeClubNames, members);
    expect(matches[0].confidence).toBe("surname");
    expect(matches[0].memberId).toBe("m1");
  });

  it("空白なし athleteKey のみの member は姓境界不明のため surname 突合に参加しない", () => {
    // 保存済み athleteKey は normalizeNameKey 済み（空白除去）＝姓を導出できない。
    const rows = [row("猪俣 祐貴", "入間市OLC")];
    const members: ExistingMemberRef[] = [
      { id: "m1", athleteKey: normalizeNameKey("猪俣 健太"), displayName: null },
    ];
    const matches = matchStartlistRows(rows, joeClubNames, members);
    expect(matches[0].confidence).toBe("none");
    expect(matches[0].memberId).toBeNull();
  });

  it("行側が姓名連結（1トークン）の場合は姓境界不明のため surname にしない", () => {
    const rows = [row("石橋一真", "入間市OLC")];
    const members: ExistingMemberRef[] = [
      { id: "m1", athleteKey: null, displayName: "石橋 大樹" },
    ];
    const matches = matchStartlistRows(rows, joeClubNames, members);
    expect(matches[0].confidence).toBe("none");
    expect(matches[0].memberId).toBeNull();
  });

  it("姓一致が複数候補なら none（曖昧）", () => {
    const rows = [row("猪俣 祐貴", "入間市OLC")];
    const members: ExistingMemberRef[] = [
      { id: "m1", athleteKey: null, displayName: "猪俣 健太" },
      { id: "m2", athleteKey: null, displayName: "猪俣 直子" },
    ];
    const matches = matchStartlistRows(rows, joeClubNames, members);
    expect(matches[0].confidence).toBe("none");
    expect(matches[0].memberId).toBeNull();
  });

  it("姓も一致しなければ none・memberId=null", () => {
    const rows = [row("猪俣 祐貴", "入間市OLC")];
    const members: ExistingMemberRef[] = [
      { id: "m1", athleteKey: normalizeNameKey("別人 花子") },
    ];
    const matches = matchStartlistRows(rows, joeClubNames, members);
    expect(matches[0].confidence).toBe("none");
    expect(matches[0].memberId).toBeNull();
  });

  it("exact が取れた行には surname フォールバックを適用しない", () => {
    // 同姓 member が複数いても、フルネーム一致があれば exact 優先。
    const rows = [row("猪俣 祐貴", "入間市OLC")];
    const members: ExistingMemberRef[] = [
      { id: "exact", athleteKey: normalizeNameKey("猪俣 祐貴") },
      { id: "other", athleteKey: normalizeNameKey("猪俣 健太") },
    ];
    const matches = matchStartlistRows(rows, joeClubNames, members);
    expect(matches[0].confidence).toBe("exact");
    expect(matches[0].memberId).toBe("exact");
  });

  it("joeClubNames が空なら空配列", () => {
    const rows = [row("猪俣 祐貴", "入間市OLC")];
    expect(matchStartlistRows(rows, [], [])).toEqual([]);
  });
});

describe("matchStartlistRows (実サンプル PDF・クラブ員フィルタ実地)", () => {
  it("members=[] でも 入間市OLC 行が 40 件以上残る（実測 46）", async () => {
    const data = new Uint8Array(readFileSync(SAMPLE_PDF));
    const rows = await extractStartlistFromPdf(data);
    const matches = matchStartlistRows(rows, ["入間市OLC"], []);
    expect(matches.length).toBeGreaterThanOrEqual(40);
    // members=[] なので全件 none・memberId=null。
    expect(matches.every((m) => m.memberId === null && m.confidence === "none")).toBe(true);
  });
});
