import { describe, it, expect } from "vitest";
import { assessQuality, DEFAULT_QUALITY_OPTS } from "../quality";
import type { OringenData, OringenPerson } from "../types";

/**
 * 品質ガードのテスト。**拒否＝既存の正常データを保持**が守られることを固定する。
 * 壊れた更新で良いデータを潰すのが最大リスク（Codex レビュー指摘）。
 */

function person(name: string, startTimes: (string | null)[]): OringenPerson {
  const entries: OringenPerson["entries"] = {};
  startTimes.forEach((t, i) => {
    entries[String(i + 1)] = [{ className: "H40", startTime: t, place: null, time: null, distanceM: null }];
  });
  return { name, kanji: null, kanjiConfidence: null, club: "Irumashi OLC", entries };
}

function data(peopleCount: number, confirmedPerPerson: number, generatedAt = "2026-07-15T00:00:00Z"): OringenData {
  const people = Array.from({ length: peopleCount }, (_, i) =>
    person(`Runner ${i}`, [
      confirmedPerPerson > 0 ? "10:22" : null,
      confirmedPerPerson > 1 ? "12:13" : null,
    ]),
  );
  return {
    generatedAt,
    eventId: 25,
    eventName: "O-Ringen Göteborg",
    resultUrl: "https://resultat.oringen.se/2026",
    races: [{ n: 1, raceId: 124, date: "2026-07-20" }],
    people,
    links: { official: "https://oringen.se", eventor: null, livelox: null, winsplits: null },
  };
}

describe("assessQuality", () => {
  it("初回（prev なし）は下限を満たせば受け入れる", () => {
    const r = assessQuality(null, data(50, 1));
    expect(r.ok).toBe(true);
  });

  it("初回でも人数が下限未満なら拒否する（壊れた初回で始めない）", () => {
    const r = assessQuality(null, data(10, 1));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("too_few_people");
  });

  it("正常な更新は受け入れる", () => {
    const prev = data(50, 1, "2026-07-15T00:00:00Z");
    const next = data(50, 2, "2026-07-16T00:00:00Z");
    expect(assessQuality(prev, next).ok).toBe(true);
  });

  it("人数の激減を拒否する（クラス取得の部分失敗）", () => {
    const prev = data(50, 1, "2026-07-15T00:00:00Z");
    const next = data(10, 1, "2026-07-16T00:00:00Z");
    const r = assessQuality(prev, next);
    expect(r.ok).toBe(false);
    // 下限(45)を先に割るので too_few_people
    expect(r.reason).toBe("too_few_people");
  });

  it("下限は満たすが前回比で減った人数を拒否する", () => {
    const prev = data(60, 1, "2026-07-15T00:00:00Z");
    const next = data(46, 1, "2026-07-16T00:00:00Z"); // 46/60 = 0.77 < 0.9
    const r = assessQuality(prev, next);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("people_regression");
  });

  it("startTime が消えたら拒否する（st フィールドの仕様変更疑い）", () => {
    const prev = data(50, 2, "2026-07-15T00:00:00Z"); // 確定 100
    const next = data(50, 0, "2026-07-16T00:00:00Z"); // 確定 0
    const r = assessQuality(prev, next);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("confirmed_starts_regression");
  });

  it("startTime が増えるのは正常（開催前は 93 → 245 へ増える）", () => {
    const prev = data(50, 1, "2026-07-15T00:00:00Z");
    const next = data(50, 2, "2026-07-16T00:00:00Z");
    expect(assessQuality(prev, next).ok).toBe(true);
  });

  it("古い generatedAt で新しいデータを潰さない（順序逆転）", () => {
    const prev = data(50, 2, "2026-07-16T00:00:00Z");
    const next = data(50, 2, "2026-07-15T00:00:00Z");
    const r = assessQuality(prev, next);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("stale_generated_at");
  });

  it("同時刻の再実行は許容する", () => {
    const prev = data(50, 2, "2026-07-16T00:00:00Z");
    const next = data(50, 2, "2026-07-16T00:00:00Z");
    expect(assessQuality(prev, next).ok).toBe(true);
  });

  it("別大会のペイロードを拒否する", () => {
    const next = { ...data(50, 1), eventId: 99 };
    const r = assessQuality(null, next);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("event_id_mismatch");
  });

  it("判定の材料を detail に返す（ログ・通知で可視化するため）", () => {
    const prev = data(50, 1, "2026-07-15T00:00:00Z");
    const next = data(50, 2, "2026-07-16T00:00:00Z");
    const r = assessQuality(prev, next);
    expect(r.detail.prevPeople).toBe(50);
    expect(r.detail.nextPeople).toBe(50);
    expect(r.detail.prevConfirmed).toBe(50);
    expect(r.detail.nextConfirmed).toBe(100);
  });

  it("既定の閾値が実データの規模と整合している", () => {
    // 2026 の検証済みロスターは50名。下限45は「欠場による自然減は許すが取得異常は弾く」水準。
    expect(DEFAULT_QUALITY_OPTS.minPeople).toBe(45);
    expect(DEFAULT_QUALITY_OPTS.expectedEventId).toBe(25);
  });
});
