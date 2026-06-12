import { describe, it, expect } from "vitest";
import {
  participationBulkSchema,
  participationCreateSchema,
  participationUpdateSchema,
  memberCreateSchema,
} from "../api/schemas";

const UUID = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
const UUID2 = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

describe("participationBulkSchema", () => {
  const memberEntry = () => ({ memberId: UUID });
  const newMemberEntry = () => ({
    newMember: { displayName: "山田太郎", athleteKey: "山田太郎" },
  });

  it("accepts a valid mixed batch", () => {
    const parsed = participationBulkSchema.safeParse({
      actorName: "児玉",
      entries: [memberEntry(), newMemberEntry()],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts exactly 30 entries", () => {
    const parsed = participationBulkSchema.safeParse({
      actorName: "児玉",
      entries: Array.from({ length: 30 }, memberEntry),
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects 31 entries", () => {
    const parsed = participationBulkSchema.safeParse({
      actorName: "児玉",
      entries: Array.from({ length: 31 }, memberEntry),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects empty entries", () => {
    const parsed = participationBulkSchema.safeParse({
      actorName: "児玉",
      entries: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a row with both memberId and newMember", () => {
    const parsed = participationBulkSchema.safeParse({
      actorName: "児玉",
      entries: [
        {
          memberId: UUID,
          newMember: { displayName: "山田太郎", athleteKey: "山田太郎" },
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a row with neither memberId nor newMember", () => {
    const parsed = participationBulkSchema.safeParse({
      actorName: "児玉",
      entries: [{ className: "M21A" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a row with only memberId", () => {
    const parsed = participationBulkSchema.safeParse({
      actorName: "児玉",
      entries: [{ memberId: UUID }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a row with only newMember", () => {
    const parsed = participationBulkSchema.safeParse({
      actorName: "児玉",
      entries: [newMemberEntry()],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects newMember missing displayName", () => {
    const parsed = participationBulkSchema.safeParse({
      actorName: "児玉",
      entries: [{ newMember: { athleteKey: "山田太郎" } }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects newMember missing athleteKey", () => {
    const parsed = participationBulkSchema.safeParse({
      actorName: "児玉",
      entries: [{ newMember: { displayName: "山田太郎" } }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects newMember with blank displayName", () => {
    const parsed = participationBulkSchema.safeParse({
      actorName: "児玉",
      entries: [{ newMember: { displayName: "   ", athleteKey: "山田太郎" } }],
    });
    expect(parsed.success).toBe(false);
  });

  it("carries optional className per entry", () => {
    const parsed = participationBulkSchema.safeParse({
      actorName: "児玉",
      entries: [{ memberId: UUID, className: "M21A" }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.entries[0].className).toBe("M21A");
  });

  it("rejects missing actorName", () => {
    const parsed = participationBulkSchema.safeParse({
      entries: [{ memberId: UUID }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("participation role enum accepts 'undecided'", () => {
  it("create accepts role 'undecided'", () => {
    const parsed = participationCreateSchema.safeParse({
      actorName: "児玉",
      memberId: UUID,
      role: "undecided",
    });
    expect(parsed.success).toBe(true);
  });

  it("update accepts role 'undecided'", () => {
    const parsed = participationUpdateSchema.safeParse({
      actorName: "児玉",
      memberId: UUID,
      role: "undecided",
    });
    expect(parsed.success).toBe(true);
  });

  it("create still rejects an unknown role", () => {
    const parsed = participationCreateSchema.safeParse({
      actorName: "児玉",
      memberId: UUID,
      role: "bogus",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("memberCreateSchema homeAreaName", () => {
  it("accepts a member with homeAreaName (optional)", () => {
    const parsed = memberCreateSchema.safeParse({
      actorName: "児玉",
      displayName: "山田太郎",
      homeAreaName: "八王子駅",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.homeAreaName).toBe("八王子駅");
  });

  it("accepts a member without homeAreaName", () => {
    const parsed = memberCreateSchema.safeParse({
      actorName: "児玉",
      displayName: "山田太郎",
    });
    expect(parsed.success).toBe(true);
  });

  it("trims homeAreaName and rejects blank", () => {
    const parsed = memberCreateSchema.safeParse({
      actorName: "児玉",
      displayName: "山田太郎",
      homeAreaName: "   ",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects homeAreaName longer than 80 chars", () => {
    const parsed = memberCreateSchema.safeParse({
      actorName: "児玉",
      displayName: "山田太郎",
      homeAreaName: "あ".repeat(81),
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts homeAreaName of exactly 80 chars", () => {
    const parsed = memberCreateSchema.safeParse({
      actorName: "児玉",
      displayName: "山田太郎",
      homeAreaName: "あ".repeat(80),
    });
    expect(parsed.success).toBe(true);
  });

  // 既存メンバーを二重に参照しても、UUID は別物なので一意性は route 層の責務。
  // ここでは併用時の受理のみ確認（homeNodeId 優先はハンドラ側）。
  it("accepts both homeNodeId and homeAreaName (handler resolves precedence)", () => {
    const parsed = memberCreateSchema.safeParse({
      actorName: "児玉",
      displayName: "山田太郎",
      homeNodeId: UUID2,
      homeAreaName: "八王子駅",
    });
    expect(parsed.success).toBe(true);
  });
});
