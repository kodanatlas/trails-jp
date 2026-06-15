import { describe, it, expect } from "vitest";
import {
  extractVenueToStartCandidates,
  extractVenueToStartMinutes,
} from "../venue-to-start";
import {
  normalizeDriveUrl,
  isAllowedProgramUrl,
} from "../startlist/url-allow";

// ---------------------------------------------------------------------------
// extractVenueToStartCandidates（候補リスト・実データ検証で拡張）
// ---------------------------------------------------------------------------

describe("extractVenueToStartCandidates", () => {
  it("実例: 「スタートまでの誘導 … 大会バス 所要時間 約30分」→ 先頭候補=30", () => {
    const text =
      "スタートまでの誘導について。会場から大会バスで移動し、所要時間 約30分です。";
    const cands = extractVenueToStartCandidates(text);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0].minutes).toBe(30);
    expect(cands[0].context).toContain("所要時間");
  });

  it("バス表現「大会バスで約25分」をスタート文脈で拾う", () => {
    const text = "スタート地区へは大会バスで約25分かかります。";
    const cands = extractVenueToStartCandidates(text);
    expect(cands.some((c) => c.minutes === 25)).toBe(true);
  });

  it("体験など別目的の所要時間（スタート文脈なし・体験）は除外/低スコア", () => {
    const text =
      "親子で楽しむ体験コーナーの所要時間 約20分。受付で説明します。";
    const cands = extractVenueToStartCandidates(text);
    // スタート文脈が無く体験/説明/受付（負語）→ score<=0 で除外。
    expect(cands).toEqual([]);
  });

  it("スタート文脈の候補が体験文脈より上位に並ぶ", () => {
    const text =
      "体験コーナーの所要時間 約20分。スタートまでの誘導は徒歩30分です。";
    const cands = extractVenueToStartCandidates(text);
    expect(cands[0].minutes).toBe(30); // スタート文脈の30が先頭
    // 体験20はスタート文脈に無いので除外される。
    expect(cands.some((c) => c.minutes === 20)).toBe(false);
  });

  it("会場からスタートまで徒歩約15分 → 15", () => {
    const cands = extractVenueToStartCandidates("会場からスタートまで徒歩約15分です。");
    expect(cands[0].minutes).toBe(15);
  });

  it("スタート地区まで徒歩20分 → 20", () => {
    const cands = extractVenueToStartCandidates("スタート地区まで徒歩20分かかります。");
    expect(cands[0].minutes).toBe(20);
  });

  it("全角「徒歩１５分」をスタート近傍で正規化して拾う → 15", () => {
    const cands = extractVenueToStartCandidates("スタートまでは徒歩１５分程度。");
    expect(cands[0].minutes).toBe(15);
  });

  it("無関係文（スタート文脈なし）は空配列", () => {
    expect(extractVenueToStartCandidates("最寄りのコンビニまで徒歩5分。")).toEqual([]);
    expect(extractVenueToStartCandidates("受付は8時30分から。")).toEqual([]);
  });

  it("0分・3桁は棄却（妥当域 1〜99 のみ）", () => {
    expect(extractVenueToStartCandidates("スタートまで徒歩0分。")).toEqual([]);
    expect(extractVenueToStartCandidates("スタートまで徒歩120分。")).toEqual([]);
  });

  it("同値 minutes は1件化（重複しない）", () => {
    const text =
      "スタートまで徒歩30分。なお会場からスタートまでは所要時間 約30分です。";
    const cands = extractVenueToStartCandidates(text);
    expect(cands.filter((c) => c.minutes === 30).length).toBe(1);
  });

  it("空文字列は空配列", () => {
    expect(extractVenueToStartCandidates("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractVenueToStartMinutes（後方互換の単一値・候補の先頭を返す）
// ---------------------------------------------------------------------------

describe("extractVenueToStartMinutes（後方互換）", () => {
  it("会場からスタートまで徒歩約15分 → 15", () => {
    expect(extractVenueToStartMinutes("会場からスタートまで徒歩約15分です。")?.minutes).toBe(15);
  });

  it("スタート地点まで徒歩20分 → 20", () => {
    expect(
      extractVenueToStartMinutes("受付後、スタート地点まで徒歩20分かかります。")?.minutes,
    ).toBe(20);
  });

  it("駐車場〜スタート 徒歩10分 → 10", () => {
    expect(extractVenueToStartMinutes("駐車場〜スタート 徒歩10分")?.minutes).toBe(10);
  });

  it("スタート文脈の無い徒歩はnull（コンビニまで徒歩5分）", () => {
    expect(extractVenueToStartMinutes("最寄りのコンビニまで徒歩5分。")).toBeNull();
  });

  it("無関係文・空文字列はnull", () => {
    expect(extractVenueToStartMinutes("大会要項。受付は8時30分から。")).toBeNull();
    expect(extractVenueToStartMinutes("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Google Drive URL 正規化・ホスト許可
// ---------------------------------------------------------------------------

describe("normalizeDriveUrl", () => {
  it("file/d/<ID>/view → uc?export=download&id=<ID>", () => {
    expect(
      normalizeDriveUrl("https://drive.google.com/file/d/ABC123_xyz/view?usp=sharing"),
    ).toBe("https://drive.google.com/uc?export=download&id=ABC123_xyz");
  });

  it("uc?id=<ID> → uc?export=download&id=<ID>", () => {
    expect(
      normalizeDriveUrl("https://drive.google.com/uc?id=ABC123_xyz&export=view"),
    ).toBe("https://drive.google.com/uc?export=download&id=ABC123_xyz");
  });

  it("open?id=<ID> → uc?export=download&id=<ID>", () => {
    expect(normalizeDriveUrl("https://drive.google.com/open?id=ID999")).toBe(
      "https://drive.google.com/uc?export=download&id=ID999",
    );
  });

  it("Drive 以外はそのまま返す", () => {
    const u = "https://japan-o-entry.com/event/getfile/10707";
    expect(normalizeDriveUrl(u)).toBe(u);
  });

  it("ID 抽出不能（Drive だが id 無し）はそのまま返す", () => {
    const u = "https://drive.google.com/drive/folders/xxx";
    expect(normalizeDriveUrl(u)).toBe(u);
  });

  it("不正 URL はそのまま返す", () => {
    expect(normalizeDriveUrl("not a url")).toBe("not a url");
  });
});

describe("isAllowedProgramUrl", () => {
  it("JOY / Drive / googleusercontent を許可", () => {
    expect(isAllowedProgramUrl("https://japan-o-entry.com/event/getfile/1")).toBe(true);
    expect(isAllowedProgramUrl("https://drive.google.com/uc?id=x")).toBe(true);
    expect(
      isAllowedProgramUrl("https://doc-0-1-docs.googleusercontent.com/abc"),
    ).toBe(true);
  });

  it("許可外ホスト・localhost・IP リテラルは拒否", () => {
    expect(isAllowedProgramUrl("https://evil.example.com/x.pdf")).toBe(false);
    expect(isAllowedProgramUrl("http://localhost/x.pdf")).toBe(false);
    expect(isAllowedProgramUrl("http://169.254.169.254/latest")).toBe(false);
    expect(isAllowedProgramUrl("not a url")).toBe(false);
  });
});
