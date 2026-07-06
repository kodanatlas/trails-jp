import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSplitListDetailed } from "../../scraper/lapcenter-detail";
import { buildClassIngest, normalizeClub, isSprint, type AthleteLookupEntry } from "../leg-ingest";

const html = readFileSync(
  fileURLToPath(
    new URL("../../scraper/__tests__/fixtures/lapcenter_splitlist_9534_c0.html", import.meta.url),
  ),
  "utf8",
);
const detailed = parseSplitListDetailed(html);

/**
 * 旧 scalar パーサ（lapcenter.ts fetchSplitList のパース部分・:397-426）の忠実な複製。
 * パリティテストの golden reference として凍結する（プロダクション側の挙動契約を文書化）。
 */
function legacyScalarParse(src: string): Array<{
  name: string; club: string; rank: number; result: string; speed: number; missRate: number;
}> {
  const runners: Array<{ name: string; club: string; rank: number; result: string; speed: number; missRate: number }> = [];
  const blocks = src.split("runnerList.push(runnerData);");
  for (const block of blocks) {
    const get = (key: string): string => {
      const m = block.match(new RegExp(`runnerData\\['${key}'\\]\\s*=\\s*'([^']*)';`));
      return m ? m[1] : "";
    };
    const name = get("runnerName");
    if (!name) continue;
    const speed = parseFloat(get("speed"));
    const missRate = parseFloat(get("lossRate"));
    if (isNaN(speed) || isNaN(missRate)) continue;
    const rank = parseInt(get("rank"), 10);
    if (isNaN(rank)) continue;
    runners.push({ name, club: get("clubName"), rank, result: get("result"), speed, missRate });
  }
  return runners;
}

/** 旧 cron ループ（route.ts 旧239-266行）の選別・整形を golden reference として複製 */
function legacyCronRecords(
  runners: ReturnType<typeof legacyScalarParse>,
  athleteLookup: Map<string, AthleteLookupEntry>,
  eventDate: string,
  eventName: string,
  className: string,
  raceType: string,
) {
  const out: Array<Record<string, unknown>> = [];
  for (const r of runners) {
    const normalized = r.name.replace(/\s+/g, "");
    const entry = athleteLookup.get(normalized);
    if (!entry) continue;
    const lcClubs = r.club ? r.club.split("/").map((c) => normalizeClub(c)) : [];
    const joyClubs = entry.clubs.map((c) => normalizeClub(c));
    const clubMatch =
      lcClubs.length === 0 ||
      joyClubs.length === 0 ||
      lcClubs.some((lc) => joyClubs.some((joy) => lc === joy || lc.includes(joy) || joy.includes(lc)));
    if (!clubMatch) continue;
    if (r.speed === 100 && r.missRate === 0) continue;
    out.push({
      athlete_name: entry.joyName,
      event_date: eventDate,
      event_name: eventName,
      class_name: className,
      cruising_speed: r.speed,
      miss_rate: r.missRate,
      race_type: raceType,
    });
  }
  return out;
}

/** フィクスチャの全走者を追跡選手にする lookup（クラブは LC のものをそのまま＝必ず照合一致） */
function lookupFromFixture(): Map<string, AthleteLookupEntry> {
  const map = new Map<string, AthleteLookupEntry>();
  for (const r of detailed) {
    map.set(r.name.replace(/\s+/g, ""), {
      joyName: r.name,
      clubs: r.club ? r.club.split("/") : [],
    });
  }
  return map;
}

const ingestArgs = {
  athleteLookup: lookupFromFixture(),
  lcEventId: 9534,
  lcClassId: 0,
  eventDate: "2026-05-01",
  eventName: "テスト大会",
  className: "M21",
  raceType: "forest" as const,
};

describe("buildClassIngest: 旧 scalar パスとのパリティ", () => {
  it("scalarRecords は旧パーサ+旧cron選別と完全一致（実フィクスチャ）", () => {
    const legacy = legacyCronRecords(
      legacyScalarParse(html),
      ingestArgs.athleteLookup,
      ingestArgs.eventDate,
      ingestArgs.eventName,
      ingestArgs.className,
      ingestArgs.raceType,
    );
    const { scalarRecords } = buildClassIngest({ ...ingestArgs, detailed });
    expect(scalarRecords).toEqual(legacy);
    expect(scalarRecords.length).toBeGreaterThan(0); // 空同士の偽パリティを防ぐ
  });
});

describe("buildClassIngest: legRows", () => {
  it("追跡選手が1人もいなければ legRows は空（クラス保持ルール）", () => {
    const { legRows, scalarRecords } = buildClassIngest({
      ...ingestArgs,
      detailed,
      athleteLookup: new Map(),
    });
    expect(legRows).toEqual([]);
    expect(scalarRecords).toEqual([]);
  });

  it("追跡選手がいれば全走者を保存（MP=rank null も含む）・tracked は名前+クラブ照合のみ", () => {
    const { legRows } = buildClassIngest({ ...ingestArgs, detailed });
    expect(legRows.length).toBe(detailed.length); // 全走者
    // フィクスチャの MP 走者（rank null）も行になる
    const mpRows = legRows.filter((r) => r.rank == null);
    expect(mpRows.length).toBe(detailed.filter((d) => d.rank == null).length);
    // 全員 lookup に入れたので tracked=true（MP 含む）
    expect(legRows.every((r) => r.tracked)).toBe(true);
  });

  it("クラブ不一致の走者は tracked=false だが legRows には残る", () => {
    // フィクスチャにクラブ付き走者が居ないため合成走者で検証
    // （クラブ空の走者は「照合スキップ=一致扱い」仕様で tracked になってしまう）
    const mk = (index: number, name: string, club: string) => ({
      index, name, club, runnerId: String(index), rank: index + 1,
      result: "10:00", start: "10:00:00", speed: 95, lossRate: 5, totalRelative: 100,
      totalLossTime: "0:30", idealTime: "9:30",
      lapTime: ["5:00", "5:00"], lapRank: [1, 1], elapsedTime: ["5:00", "10:00"],
      elapsedRank: [index + 1, index + 1], legLossTime: ["0:10", "0:20"], legSpeed: [100, 100],
    });
    const synth = [mk(0, "所属 一致", "京大"), mk(1, "所属 不一致", "京大")];
    const lookup = new Map<string, AthleteLookupEntry>([
      ["所属一致", { joyName: "所属一致", clubs: ["京都大学"] }],
      ["所属不一致", { joyName: "所属不一致", clubs: ["ZZZ会"] }],
    ]);
    const { legRows } = buildClassIngest({ ...ingestArgs, detailed: synth, athleteLookup: lookup });
    expect(legRows.length).toBe(2); // 一致1名がいるのでクラス保持・全走者保存
    expect(legRows.find((r) => r.runner_index === 0)!.tracked).toBe(true);
    expect(legRows.find((r) => r.runner_index === 1)!.tracked).toBe(false);
  });

  it("秒変換: result/lap/loss が秒 int・legLossTime の符号保持・欠測は null", () => {
    const { legRows } = buildClassIngest({ ...ingestArgs, detailed });
    const withRank = legRows.find((r) => r.rank === 1)!;
    expect(typeof withRank.result_sec).toBe("number");
    expect(withRank.lap_sec.length).toBe(withRank.leg_loss_sec.length);
    // legLossTime には負値（基準より速い）が存在する
    expect(legRows.some((r) => r.leg_loss_sec.some((v) => v != null && v < 0))).toBe(true);
    // lap_sec は全て正
    expect(withRank.lap_sec.every((v) => v == null || v > 0)).toBe(true);
  });

  it("runner_index はパース順・runner_key は空白除去", () => {
    const { legRows } = buildClassIngest({ ...ingestArgs, detailed });
    for (const row of legRows) {
      expect(row.runner_key).toBe(row.runner_name.replace(/\s+/g, ""));
    }
    expect(new Set(legRows.map((r) => r.runner_index)).size).toBe(legRows.length);
  });
});

describe("isSprint / normalizeClub（leg-ingest へ移設後の回帰）", () => {
  it("sprint 判定", () => {
    expect(isSprint("全日本スプリント")).toBe(true);
    expect(isSprint("パークOツアー")).toBe(true);
    expect(isSprint("全日本ロング")).toBe(false);
  });
  it("クラブ正規化", () => {
    expect(normalizeClub("京大")).toBe("京都大学");
    expect(normalizeClub("東京ＯＬクラブ")).toBe("東京");
    expect(normalizeClub("練馬")).toBe("練馬OLC");
  });
});
