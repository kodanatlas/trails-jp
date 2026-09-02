import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fixture = vi.hoisted(() => {
  const athlete = (name: string, clubs: string[], bestRank: number) => ({
    name,
    clubs,
    appearances: [],
    bestRank,
    avgTotalPoints: bestRank * 100,
    forestCount: 2,
    sprintCount: 1,
    type: "allrounder" as const,
    recentForm: 3,
  });

  const ranked = Object.fromEntries(
    Array.from({ length: 25 }, (_, index) => {
      const suffix = String(index + 1).padStart(2, "0");
      return [
        `順位選手${suffix}`,
        athlete(`順位 選手${suffix}`, [], 25 - index),
      ];
    })
  );

  const index = {
    athletes: {
      小牧弘季: athlete("小牧 弘季", ["トータス"], 7),
      山田太郎: athlete("山田太郎", ["Tokyo ABC"], 12),
      "鈴木健太（筑波大学）": athlete("鈴木健太（筑波大学）", ["筑波大学"], 4),
      "鈴木健太（金沢大学）": athlete("鈴木健太（金沢大学）", ["金沢大学"], 8),
      "A選手": athlete("A選手", ["Aクラブ"], 1),
      ...ranked,
    },
    generatedAt: "2026-09-01T00:00:00.000Z",
  };

  return {
    index,
    readFileSync: vi.fn(() => JSON.stringify(index)),
  };
});

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, readFileSync: fixture.readFileSync };
});

import { GET } from "./route";

const request = (q?: string) =>
  new NextRequest(
    q === undefined
      ? "https://example.com/api/athletes/search"
      : `https://example.com/api/athletes/search?q=${encodeURIComponent(q)}`
  );

const search = async (q: string) => {
  const response = await GET(request(q));
  return {
    response,
    body: (await response.json()) as { athletes: Array<Record<string, unknown>> },
  };
};

describe("GET /api/athletes/search", () => {
  it("氏名の部分一致でヒットする", async () => {
    const { body } = await search("弘季");

    expect(body.athletes.map((item) => item.name)).toEqual(["小牧 弘季"]);
  });

  it.each(["小牧弘季", "小牧 弘季"])("空白の有無を無視して %s でヒットする", async (q) => {
    const { body } = await search(q);

    expect(body.athletes.map((item) => item.name)).toContain("小牧 弘季");
  });

  it("所属名の部分一致で大文字小文字を無視してヒットする", async () => {
    const { body } = await search("tokyo");

    expect(body.athletes.map((item) => item.name)).toEqual(["山田太郎"]);
  });

  it("ASCII 1文字は空配列を返す", async () => {
    const { body } = await search("A");

    expect(body.athletes).toEqual([]);
  });

  it("best_rank 昇順で最大20件を返す", async () => {
    const { body } = await search("順位選手");

    expect(body.athletes).toHaveLength(20);
    expect(body.athletes.map((item) => item.best_rank)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1)
    );
  });

  it("分離済みの同姓同名をどちらも返す", async () => {
    const { body } = await search("鈴木健太");

    expect(body.athletes.map((item) => item.name)).toEqual([
      "鈴木健太（筑波大学）",
      "鈴木健太（金沢大学）",
    ]);
  });

  it("索引に無い旧統合名は返さない", async () => {
    const { body } = await search("旧統合名");

    expect(body.athletes).toEqual([]);
  });

  it("従来の snake_case レスポンス形状とキャッシュ指定を維持する", async () => {
    const { response, body } = await search("小牧弘季");

    expect(body.athletes[0]).toEqual({
      name: "小牧 弘季",
      clubs: ["トータス"],
      best_rank: 7,
      avg_total_points: 700,
      forest_count: 2,
      sprint_count: 1,
      athlete_type: "allrounder",
      recent_form: 3,
    });
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=60");
  });

  it("q が無い場合は400を返す", async () => {
    const response = await GET(request());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Missing q param" });
  });
});
