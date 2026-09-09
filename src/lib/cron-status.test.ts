import { describe, expect, it } from "vitest";
import { assessJobHealth, type CronLogRow } from "./cron-status";

/**
 * 開始記録(status=started)が健全性判定に混ざると、中断した日ほど状態が良く見えるという
 * 退行が起きる。2026-09-09 のレビューで実際に検出されたため、その形をここで固定する。
 *
 * 実時刻に依存させると監視テスト自身が将来腐って沈黙するため、now は常に注入する。
 */

const NOW = new Date("2026-09-09T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1_000;

function row(
  ageHours: number,
  status: string,
  overrides: Partial<CronLogRow> = {},
): CronLogRow {
  return {
    id: Math.round(ageHours * 1000),
    job_name: "sync-lapcenter",
    status,
    result: { runners: {} },
    duration_ms: 31_000,
    created_at: new Date(NOW.getTime() - ageHours * HOUR_MS).toISOString(),
    ...overrides,
  };
}

describe("assessJobHealth: 開始記録の除外", () => {
  it("中断日（27時間前の success + 3時間前の started）を緑と誤判定しない", () => {
    const withoutStarted = assessJobHealth("sync-lapcenter", [row(27, "success")], NOW);
    const withStarted = assessJobHealth(
      "sync-lapcenter",
      [row(3, "started"), row(27, "success")],
      NOW,
    );

    // started 行の有無で判定が変わってはいけない（変わると中断日に警告が消える）
    expect(withStarted.overall).toBe(withoutStarted.overall);
    expect(withStarted.reasons).toEqual(withoutStarted.reasons);
    expect(withStarted.ageMs).toBe(withoutStarted.ageMs);
    expect(withStarted.latest?.status).toBe("success");
  });

  it("27時間前の完了記録は started があっても「24-48時間 未実行」と報告する", () => {
    const assessment = assessJobHealth(
      "sync-lapcenter",
      [row(3, "started"), row(27, "success")],
      NOW,
    );

    expect(assessment.reasons).toContain("24-48時間 未実行");
  });

  it("latest と lastSuccess に started 行を採用しない", () => {
    const assessment = assessJobHealth(
      "sync-lapcenter",
      [row(1, "started"), row(5, "success")],
      NOW,
    );

    expect(assessment.latest?.status).toBe("success");
    expect(assessment.lastSuccess?.status).toBe("success");
    expect(assessment.ageMs).toBe(5 * HOUR_MS);
  });

  it("started しか無ければ実行履歴なしとして赤にする", () => {
    const assessment = assessJobHealth("sync-lapcenter", [row(1, "started")], NOW);

    expect(assessment.overall).toBe("red");
    expect(assessment.reasons).toContain("実行履歴なし");
    expect(assessment.latest).toBeNull();
  });

  it("直近の完了記録が error なら started があっても赤のままにする", () => {
    const assessment = assessJobHealth(
      "sync-lapcenter",
      [row(1, "started"), row(2, "error")],
      NOW,
    );

    expect(assessment.overall).toBe("red");
    expect(assessment.reasons).toContain("直近実行が error");
  });
});
