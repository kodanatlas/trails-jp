import { describe, it, expect } from "vitest";
import {
  seatsToCapacity,
  capacityToSeats,
  memberCreateSchema,
  travelTimesPutSchema,
  eventCreateSchema,
  participationCreateSchema,
  participationUpdateSchema,
} from "../api/schemas";

describe("seatsToCapacity / capacityToSeats", () => {
  it("round-trips 0 → 1 → 0", () => {
    expect(seatsToCapacity(0)).toBe(1);
    expect(capacityToSeats(1)).toBe(0);
    expect(capacityToSeats(seatsToCapacity(0))).toBe(0);
  });

  it("round-trips 3 → 4 → 3", () => {
    expect(seatsToCapacity(3)).toBe(4);
    expect(capacityToSeats(4)).toBe(3);
    expect(capacityToSeats(seatsToCapacity(3))).toBe(3);
  });

  it("passes null through both directions", () => {
    expect(seatsToCapacity(null)).toBeNull();
    expect(capacityToSeats(null)).toBeNull();
  });

  it("treats undefined as null", () => {
    expect(seatsToCapacity(undefined)).toBeNull();
    expect(capacityToSeats(undefined)).toBeNull();
  });

  it("floors capacityToSeats(0) at 0 (no negative)", () => {
    expect(capacityToSeats(0)).toBe(0);
  });
});

describe("memberCreateSchema", () => {
  it("accepts a valid member", () => {
    const parsed = memberCreateSchema.safeParse({
      actorName: "児玉",
      displayName: "山田太郎",
      seatsAvailable: 3,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects missing actorName", () => {
    const parsed = memberCreateSchema.safeParse({
      displayName: "山田太郎",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects actorName longer than 30 chars", () => {
    const parsed = memberCreateSchema.safeParse({
      actorName: "あ".repeat(31),
      displayName: "山田太郎",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects negative seatsAvailable", () => {
    const parsed = memberCreateSchema.safeParse({
      actorName: "児玉",
      displayName: "山田太郎",
      seatsAvailable: -1,
    });
    expect(parsed.success).toBe(false);
  });

  it("trims actorName and requires at least 1 non-space char", () => {
    const ok = memberCreateSchema.safeParse({
      actorName: "  児玉  ",
      displayName: "山田太郎",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.actorName).toBe("児玉");

    const blank = memberCreateSchema.safeParse({
      actorName: "   ",
      displayName: "山田太郎",
    });
    expect(blank.success).toBe(false);
  });
});

describe("travelTimesPutSchema", () => {
  const makeEntry = () => ({
    fromNodeId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    toNodeId: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
    mode: "car" as const,
    minutes: 30,
  });

  it("rejects more than 200 entries", () => {
    const parsed = travelTimesPutSchema.safeParse({
      actorName: "児玉",
      entries: Array.from({ length: 201 }, makeEntry),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects empty entries", () => {
    const parsed = travelTimesPutSchema.safeParse({
      actorName: "児玉",
      entries: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts exactly 200 entries", () => {
    const parsed = travelTimesPutSchema.safeParse({
      actorName: "児玉",
      entries: Array.from({ length: 200 }, makeEntry),
    });
    expect(parsed.success).toBe(true);
  });
});

describe("date / time string formats", () => {
  it("rejects badly formatted eventDate", () => {
    const parsed = eventCreateSchema.safeParse({
      actorName: "児玉",
      name: "大会",
      eventDate: "2026/06/12",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a well-formatted eventDate", () => {
    const parsed = eventCreateSchema.safeParse({
      actorName: "児玉",
      name: "大会",
      eventDate: "2026-06-12",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid participation startTime '25:00'", () => {
    const parsed = participationCreateSchema.safeParse({
      actorName: "児玉",
      memberId: "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f",
      role: "driver",
      startTime: "25:00",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a valid participation startTime '09:30'", () => {
    const parsed = participationCreateSchema.safeParse({
      actorName: "児玉",
      memberId: "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f",
      role: "driver",
      startTime: "09:30",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a non-existent eventDate '2026-02-31'", () => {
    const parsed = eventCreateSchema.safeParse({
      actorName: "児玉",
      name: "大会",
      eventDate: "2026-02-31",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("participationUpdateSchema (true partial update)", () => {
  const memberId = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";

  it("accepts an update without role (role is optional)", () => {
    const parsed = participationUpdateSchema.safeParse({
      actorName: "児玉",
      memberId,
      notes: "更新メモ",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an update with role", () => {
    const parsed = participationUpdateSchema.safeParse({
      actorName: "児玉",
      memberId,
      role: "rider",
    });
    expect(parsed.success).toBe(true);
  });

  it("still requires memberId", () => {
    const parsed = participationUpdateSchema.safeParse({
      actorName: "児玉",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("pickupPrefs array limit", () => {
  const makePref = () => ({
    nodeId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    strength: "soft" as const,
  });

  it("rejects more than 20 pickupPrefs on memberCreateSchema", () => {
    const parsed = memberCreateSchema.safeParse({
      actorName: "児玉",
      displayName: "山田太郎",
      pickupPrefs: Array.from({ length: 21 }, makePref),
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts exactly 20 pickupPrefs", () => {
    const parsed = memberCreateSchema.safeParse({
      actorName: "児玉",
      displayName: "山田太郎",
      pickupPrefs: Array.from({ length: 20 }, makePref),
    });
    expect(parsed.success).toBe(true);
  });
});
