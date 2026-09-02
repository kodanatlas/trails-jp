import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fixture = vi.hoisted(() => {
  const index = {
    athletes: {
      小牧弘季: {
        name: "小牧 弘季",
        clubs: ["トータス"],
        appearances: [
          {
            type: "age_forest",
            className: "M21",
            rank: 7,
            totalPoints: 6543.2,
            isActive: true,
          },
        ],
        bestRank: 7,
        avgTotalPoints: 6543.2,
        forestCount: 1,
        sprintCount: 0,
        type: "forester",
        recentForm: 5,
        adjustedPoints: 7000,
      },
    },
    generatedAt: "2026-09-01T00:00:00.000Z",
  };

  return {
    readFileSync: vi.fn(() => JSON.stringify(index)),
  };
});

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, readFileSync: fixture.readFileSync };
});

import { GET } from "./route";

const request = new NextRequest("https://example.com/api/athletes/%E5%B0%8F%E7%89%A7%E5%BC%98%E5%AD%A3");

describe("GET /api/athletes/[name]", () => {
  it("空白除去した索引キーで検索し、従来のレスポンス形状だけを返す", async () => {
    const response = await GET(request, {
      params: Promise.resolve({ name: encodeURIComponent("小牧 弘季") }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      name: "小牧 弘季",
      clubs: ["トータス"],
      bestRank: 7,
      avgTotalPoints: 6543.2,
      forestCount: 1,
      sprintCount: 0,
      type: "forester",
      recentForm: 5,
      appearances: [
        {
          type: "age_forest",
          className: "M21",
          rank: 7,
          totalPoints: 6543.2,
          isActive: true,
        },
      ],
    });
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=600, stale-while-revalidate=86400"
    );
  });

  it("索引に無い選手は404を返す", async () => {
    const response = await GET(request, {
      params: Promise.resolve({ name: encodeURIComponent("旧統合名") }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
  });
});
