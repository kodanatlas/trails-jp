import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * assertOwnedByClub / hasOwnershipViolation のテスト（B1: クラブ跨ぎ書込み防止）。
 *
 * supabaseAdmin をモックし、from→select→in→eq のチェーンが
 * { data, error } の Promise を解決する形を再現する。
 */

// チェーン末端が解決する値をテストごとに差し替えるためのホルダ。
const chainResult: { data: unknown; error: unknown } = { data: [], error: null };
// in() に渡された ids を記録（呼び出し検証用）。
const calls: { table: string; ids: unknown }[] = [];

vi.mock("@/lib/supabase-admin", () => {
  // from() が返すクエリビルダ。select→in→eq とチェーンでき、最後に await される。
  function makeBuilder(table: string) {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.in = (_col: string, ids: unknown) => {
      calls.push({ table, ids });
      return builder;
    };
    builder.eq = () => builder;
    // thenable: await builder で chainResult を返す。
    builder.then = (resolve: (v: typeof chainResult) => unknown) => resolve(chainResult);
    return builder;
  }
  return {
    supabaseAdmin: {
      from: (table: string) => makeBuilder(table),
    },
  };
});

import { assertOwnedByClub, hasOwnershipViolation } from "../api/helpers";

beforeEach(() => {
  chainResult.data = [];
  chainResult.error = null;
  calls.length = 0;
});

describe("hasOwnershipViolation (pure)", () => {
  it("requested == found なら違反なし", () => {
    expect(hasOwnershipViolation(2, 2)).toBe(false);
  });

  it("found < requested なら違反", () => {
    expect(hasOwnershipViolation(2, 1)).toBe(true);
  });

  it("found > requested でも一致しなければ違反", () => {
    expect(hasOwnershipViolation(1, 2)).toBe(true);
  });

  it("0 件要求は違反なし", () => {
    expect(hasOwnershipViolation(0, 0)).toBe(false);
  });
});

describe("assertOwnedByClub", () => {
  it("(a) 要求2件・取得1件 → 404 NextResponse を返す", async () => {
    chainResult.data = [{ id: "n1" }]; // 1件しか見つからない
    chainResult.error = null;

    const res = await assertOwnedByClub("club-1", { nodes: ["n1", "n2"] });
    expect(res).not.toBeNull();
    expect(res?.status).toBe(404);
    const body = await res!.json();
    expect(body.error).toBe("指定されたデータはこのクラブに属していません");
    // DB は呼ばれている。
    expect(calls.length).toBe(1);
    expect(calls[0].table).toBe("carpool_nodes");
  });

  it("(b) 全件一致 → null を返す", async () => {
    chainResult.data = [{ id: "n1" }, { id: "n2" }];
    chainResult.error = null;

    const res = await assertOwnedByClub("club-1", { nodes: ["n1", "n2"] });
    expect(res).toBeNull();
    expect(calls.length).toBe(1);
  });

  it("(c) refs が空 → DB を呼ばず null", async () => {
    const res = await assertOwnedByClub("club-1", {});
    expect(res).toBeNull();
    expect(calls.length).toBe(0);
  });

  it("(c') refs が null/undefined 要素のみ → DB を呼ばず null", async () => {
    const res = await assertOwnedByClub("club-1", {
      nodes: [null, undefined],
      members: [undefined],
    });
    expect(res).toBeNull();
    expect(calls.length).toBe(0);
  });

  it("重複 id は dedupe され、ユニーク件数で照合する", async () => {
    // 要求 ["n1","n1"] は dedupe で 1 件。取得 1 件 → 一致 → null。
    chainResult.data = [{ id: "n1" }];
    const res = await assertOwnedByClub("club-1", { nodes: ["n1", "n1"] });
    expect(res).toBeNull();
    expect((calls[0].ids as unknown[]).length).toBe(1);
  });

  it("DB error 時は 500 NextResponse を返す", async () => {
    chainResult.data = null;
    chainResult.error = { message: "boom" };
    const res = await assertOwnedByClub("club-1", { nodes: ["n1"] });
    expect(res).not.toBeNull();
    expect(res?.status).toBe(500);
  });
});
