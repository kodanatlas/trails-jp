import { describe, it, expect } from "vitest";
import { buildCreatorMemberBody } from "../onboarding";

describe("buildCreatorMemberBody (M1: クラブ作成者の member 化 body)", () => {
  it("uses the creator's name for both actorName and displayName", () => {
    const body = buildCreatorMemberBody("山田太郎");
    expect(body).toEqual({ actorName: "山田太郎", displayName: "山田太郎" });
  });

  it("trims surrounding whitespace", () => {
    const body = buildCreatorMemberBody("  山田太郎  ");
    expect(body).toEqual({ actorName: "山田太郎", displayName: "山田太郎" });
  });

  it("returns null for empty input", () => {
    expect(buildCreatorMemberBody("")).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(buildCreatorMemberBody("   ")).toBeNull();
    expect(buildCreatorMemberBody("　")).toBeNull(); // 全角スペース
  });

  it("does not include athleteKey (server auto-derives from displayName)", () => {
    const body = buildCreatorMemberBody("山田太郎");
    expect(body).not.toBeNull();
    expect(Object.keys(body!).sort()).toEqual(["actorName", "displayName"]);
  });
});
