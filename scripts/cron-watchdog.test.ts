import { describe, expect, it } from "vitest";
import {
  cronLogUrl,
  decodeResponse,
  judge,
  parseCreatedAt,
  type JobName,
  type JudgeInput,
  type ResourceResult,
} from "./cron-watchdog";

/**
 * cron の時刻そのものではなく「取得済み履歴と注入時刻」の関係だけを固定する。
 * 実時間や Supabase に依存させないことで、監視テスト自身が将来腐って沈黙するのを防ぐ。
 */

const NOW_MS = Date.parse("2026-08-14T16:17:00.000Z");
const HOUR_MS = 60 * 60 * 1_000;

function row(
  ageHours: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    job_name: "unused",
    created_at: new Date(NOW_MS - ageHours * HOUR_MS).toISOString(),
    status: "success",
    result: {},
    ...overrides,
  };
}

function rowsResource(rows: readonly unknown[]): ResourceResult {
  return { ok: true, rows };
}

function healthyRows(job: JobName): readonly unknown[] {
  return [
    row(1, {
      job_name: job,
      result: job === "sync-lapcenter" ? { runners: {} } : {},
    }),
  ];
}

function healthyInput(): JudgeInput {
  return {
    cronLogs: {
      "sync-events": rowsResource(healthyRows("sync-events")),
      "sync-entries": rowsResource(healthyRows("sync-entries")),
      "sync-lapcenter": rowsResource(healthyRows("sync-lapcenter")),
    },
    lcPerformances: rowsResource([{ event_date: "2026-08-10" }]),
  };
}

function replaceJob(
  input: JudgeInput,
  job: JobName,
  resource: ResourceResult,
): JudgeInput {
  return {
    ...input,
    cronLogs: { ...input.cronLogs, [job]: resource },
  };
}

function diagnosticsFor(input: JudgeInput, category: string) {
  return judge(input, NOW_MS).diagnostics.filter(
    (diagnostic) => diagnostic.category === category,
  );
}

describe("judge: 正常", () => {
  it("3ジョブとも新しく success なら ok とサマリを返す", () => {
    const result = judge(healthyInput(), NOW_MS);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.summaries).toHaveLength(3);
    expect(result.summaries.every((summary) => summary.includes("JST"))).toBe(true);
    expect(result.lcPerformanceSummary).toContain("2026-08-10");
  });
});

describe("judge: 区分 A", () => {
  it("1ジョブだけ最新実行が30時間前なら job 名と実値を報告する", () => {
    const input = replaceJob(
      healthyInput(),
      "sync-entries",
      rowsResource([row(30)]),
    );
    const result = judge(input, NOW_MS);
    const errors = diagnosticsFor(input, "A");

    expect(result.ok).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].job).toBe("sync-entries");
    expect(errors[0].message).toContain("age_h=30.000");
  });

  it("26時間境界は25:59:59なら正常、26:00:01なら異常", () => {
    const justInside = 26 - 1 / 3_600;
    const justOutside = 26 + 1 / 3_600;
    const insideInput = replaceJob(
      healthyInput(),
      "sync-events",
      rowsResource([row(justInside)]),
    );
    const outsideInput = replaceJob(
      healthyInput(),
      "sync-events",
      rowsResource([row(justOutside)]),
    );

    expect(judge(insideInput, NOW_MS).ok).toBe(true);
    expect(judge(outsideInput, NOW_MS).ok).toBe(false);
    expect(diagnosticsFor(outsideInput, "A")[0].job).toBe("sync-events");
  });

  it("行が0件なら異常", () => {
    const input = replaceJob(
      healthyInput(),
      "sync-lapcenter",
      rowsResource([]),
    );

    expect(judge(input, NOW_MS).ok).toBe(false);
    expect(diagnosticsFor(input, "A")).toEqual([
      expect.objectContaining({ job: "sync-lapcenter", message: "cron_log rows=0" }),
    ]);
  });
});

describe("judge: 区分 A2", () => {
  it("最新は新しくても履歴途中の30時間間隔を検知する", () => {
    const input = replaceJob(
      healthyInput(),
      "sync-events",
      rowsResource([row(1), row(25), row(55), row(79)]),
    );
    const errors = diagnosticsFor(input, "A2");

    expect(judge(input, NOW_MS).ok).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(
      expect.objectContaining({ job: "sync-events" }),
    );
    expect(errors[0].message).toContain("gap_h=30.000");
  });

  it("7日窓の直前から今日までの長期欠測が復旧した場合も検知する", () => {
    const input = replaceJob(
      healthyInput(),
      "sync-entries",
      rowsResource([row(1), row(193)]),
    );
    const result = judge(input, NOW_MS);
    const errors = diagnosticsFor(input, "A2");

    expect(result.ok).toBe(false);
    expect(diagnosticsFor(input, "A")).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].job).toBe("sync-entries");
    expect(errors[0].message).toContain("gap_h=192.000");
    expect(
      result.summaries.find((summary) => summary.includes("job=sync-entries")),
    ).toContain("runs_7d=1 max_gap_h=n/a");
  });

  it("gap の新しい側が7日窓より前なら過去の欠測を検知し続けない", () => {
    const input = replaceJob(
      healthyInput(),
      "sync-events",
      rowsResource([
        row(1),
        row(25),
        row(49),
        row(73),
        row(97),
        row(121),
        row(145),
        row(169),
        row(400),
      ]),
    );
    const result = judge(input, NOW_MS);

    expect(result.ok).toBe(true);
    expect(diagnosticsFor(input, "A2")).toEqual([]);
    expect(
      result.summaries.find((summary) => summary.includes("job=sync-events")),
    ).toContain("runs_7d=7 max_gap_h=24.000");
  });
});

describe("judge: 区分 B", () => {
  it("lapcenter の直近2件に runners.error があれば status=success でも異常", () => {
    const failed = { runners: { error: "upstream unavailable" } };
    const input = replaceJob(
      healthyInput(),
      "sync-lapcenter",
      rowsResource([
        row(1, { result: failed }),
        row(25, { result: failed }),
      ]),
    );
    const errors = diagnosticsFor(input, "B");

    expect(judge(input, NOW_MS).ok).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].job).toBe("sync-lapcenter");
    expect(errors[0].message).toContain("result.runners.error=present");
  });

  it("直近2件のうち単発失敗だけなら正常", () => {
    const input = replaceJob(
      healthyInput(),
      "sync-lapcenter",
      rowsResource([
        row(1, { result: { runners: {} } }),
        row(25, { result: { runners: { error: "temporary" } } }),
      ]),
    );

    expect(judge(input, NOW_MS).ok).toBe(true);
    expect(diagnosticsFor(input, "B")).toEqual([]);
  });

  it.each([
    ["result=null", "sync-events" as const, null],
    ["result=文字列", "sync-entries" as const, "unexpected"],
    ["lapcenter runners 欠落", "sync-lapcenter" as const, {}],
  ])("失敗定義: %s を失敗扱いする", (_label, job, result) => {
    const input = replaceJob(
      healthyInput(),
      job,
      rowsResource([row(1, { result }), row(25, { result })]),
    );
    const errors = diagnosticsFor(input, "B");

    expect(judge(input, NOW_MS).ok).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].job).toBe(job);
  });
});

describe("judge: 区分 B2", () => {
  it("直近7日に非連続の失敗が3件あれば最新成功でも異常", () => {
    const failed = { status: "error", result: {} };
    const input = replaceJob(
      healthyInput(),
      "sync-entries",
      rowsResource([
        row(1),
        row(24, failed),
        row(48),
        row(72, failed),
        row(96),
        row(120, failed),
      ]),
    );
    const errors = diagnosticsFor(input, "B2");

    expect(judge(input, NOW_MS).ok).toBe(false);
    expect(diagnosticsFor(input, "B")).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].job).toBe("sync-entries");
    expect(errors[0].message).toContain("failures_7d=3");
  });
});

describe("judge: 区分 D", () => {
  it.each([
    ["HTTP 401", decodeResponse(401, "[]")],
    ["HTTP 500", decodeResponse(500, "[]")],
    ["非JSON", decodeResponse(200, "not-json")],
    ["配列でない", decodeResponse(200, '{"rows":[]}')],
  ])("%s を取得異常にする", (_label, resource) => {
    const input = replaceJob(healthyInput(), "sync-events", resource);
    const result = judge(input, NOW_MS);
    const errors = diagnosticsFor(input, "D");

    expect(result.ok).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].job).toBe("sync-events");
  });
});

describe("時刻の決定性", () => {
  it("小数秒6桁とオフセット付き created_at を正しくパースする", () => {
    expect(parseCreatedAt("2026-08-13T10:48:09.807947+00:00")).toBe(
      Date.parse("2026-08-13T10:48:09.807Z"),
    );
  });

  it("すべての判定は注入した nowMs にだけ依存する", () => {
    const fixedRow = {
      created_at: "2026-08-13T15:17:01.000Z",
      status: "success",
      result: {},
    };
    const input = replaceJob(
      healthyInput(),
      "sync-events",
      rowsResource([fixedRow]),
    );

    expect(judge(input, NOW_MS).ok).toBe(true);
    expect(judge(input, NOW_MS + 2 * HOUR_MS).ok).toBe(false);
  });
});

describe("judge: 区分 C", () => {
  function withStart(ageHours: number, input = healthyInput()): JudgeInput {
    return {
      ...input,
      startedRuns: { "sync-lapcenter": rowsResource([row(ageHours)]) },
    };
  }

  it("startedRuns 省略時は報告しない", () => {
    expect(diagnosticsFor(healthyInput(), "C")).toEqual([]);
  });

  it("開始記録が最新の完了記録より古ければ報告しない", () => {
    expect(diagnosticsFor(withStart(2), "C")).toEqual([]);
  });

  it("完了記録より新しい開始記録が1時間前なら実値を報告する", () => {
    const input = withStart(1, replaceJob(
      healthyInput(), "sync-lapcenter", rowsResource([row(2, { result: { runners: {} } })]),
    ));
    const errors = diagnosticsFor(input, "C");
    expect(errors).toHaveLength(1);
    expect(errors[0].job).toBe("sync-lapcenter");
    expect(errors[0].message).toContain(`started=${row(1).created_at}`);
    expect(errors[0].message).toContain("age_h=1.000");
    expect(errors[0].message).toContain("完了記録が開始記録より古い");
  });

  it("完了記録より新しくても10分前の開始は実行中として報告しない", () => {
    expect(diagnosticsFor(withStart(10 / 60), "C")).toEqual([]);
  });

  it("完了記録が0件で1時間前の開始記録だけなら報告する", () => {
    const input = withStart(1, replaceJob(healthyInput(), "sync-lapcenter", rowsResource([])));
    const errors = diagnosticsFor(input, "C");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("完了記録なし");
  });

  it("開始記録の取得失敗は C も D も報告しない", () => {
    const input: JudgeInput = {
      ...healthyInput(),
      startedRuns: { "sync-lapcenter": { ok: false, detail: "HTTP 500" } },
    };
    expect(judge(input, NOW_MS).diagnostics).toEqual([]);
  });

  it("開始記録が空または日時が不正なら報告しない", () => {
    for (const rows of [[], [{ created_at: "invalid" }], [{}]]) {
      expect(diagnosticsFor({
        ...healthyInput(), startedRuns: { "sync-lapcenter": rowsResource(rows) },
      }, "C")).toEqual([]);
    }
  });

  it("開始と完了が同時刻なら報告しない", () => {
    expect(diagnosticsFor(withStart(1), "C")).toEqual([]);
  });

  it("30分ちょうどは報告せず1秒超過すると報告する", () => {
    expect(diagnosticsFor(withStart(0.5), "C")).toEqual([]);
    expect(diagnosticsFor(withStart(0.5 + 1 / 3_600), "C")).toHaveLength(1);
  });

  it("完了記録の取得失敗では1時間前の開始記録があっても C は出さず D のみ報告する", () => {
    const input = withStart(1, replaceJob(
      healthyInput(), "sync-lapcenter", { ok: false, detail: "HTTP 500" },
    ));
    expect(diagnosticsFor(input, "C")).toHaveLength(0);
    expect(diagnosticsFor(input, "D")).toHaveLength(1);
  });
});


describe("cronLogUrl", () => {
  it("開始記録だけを除外し、未知の status を除外する列挙フィルタを使わない", () => {
    const url = cronLogUrl("sync-lapcenter");
    expect(url).toContain("status=neq.started");
    expect(url).not.toContain("status=in.");
  });
});

describe("judge: 完了記録の取得失敗", () => {
  it("1時間前の開始記録があっても中断の証拠とせず区分 C を報告しない", () => {
    const input: JudgeInput = {
      ...replaceJob(healthyInput(), "sync-lapcenter", { ok: false, detail: "HTTP 500" }),
      startedRuns: { "sync-lapcenter": rowsResource([row(1)]) },
    };
    expect(diagnosticsFor(input, "C")).toEqual([]);
  });
});
