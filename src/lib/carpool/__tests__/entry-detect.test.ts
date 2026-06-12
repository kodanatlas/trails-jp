import { describe, it, expect } from "vitest";
import {
  normalizeClubNameSet,
  matchAffiliation,
  detectClubEntries,
  collectEntriesForEvent,
  type EntryWithNameKey,
  type ExistingMemberRef,
} from "../entry-detect";
import { normalizeNameKey } from "../../name-key";
import type { EntryIndex, AthleteEntryRef } from "../../entries/index-types";

describe("normalizeClubNameSet / matchAffiliation", () => {
  it("folds '入間市olc' and '入間市OLC' to the same normalized value", () => {
    const set = normalizeClubNameSet(["入間市olc"]);
    // 正規化後は OLC（大文字）に統一される
    expect(set.has("入間市OLC")).toBe(true);
    expect(matchAffiliation("入間市OLC", set)).toBeTruthy();
    expect(matchAffiliation("入間市olc", set)).toBeTruthy();
  });

  it("returns null for an unrelated affiliation", () => {
    const set = normalizeClubNameSet(["入間市OLC"]);
    expect(matchAffiliation("練馬OLC", set)).toBeNull();
  });
});

describe("detectClubEntries", () => {
  const joeClubNames = ["入間市OLC"];

  const entry = (name: string, className: string, affiliation: string): EntryWithNameKey => ({
    nameKey: normalizeNameKey(name),
    className,
    affiliation,
  });

  it("matches a slash multi-affiliation '入間市OLC/東京大学'", () => {
    const entries = [entry("山田太郎", "M21A", "入間市OLC/東京大学")];
    const detected = detectClubEntries(entries, joeClubNames, []);
    expect(detected).toHaveLength(1);
    expect(detected[0].matchedClubName).toBe("入間市OLC");
    expect(detected[0].affiliation).toBe("入間市OLC/東京大学");
  });

  it("excludes a non-club entry '練馬OLC'", () => {
    const entries = [entry("佐藤花子", "W21A", "練馬OLC")];
    const detected = detectClubEntries(entries, joeClubNames, []);
    expect(detected).toHaveLength(0);
  });

  it("sets memberId & alreadyRegistered=true for a matching athleteKey", () => {
    const entries = [entry("田中一郎", "M21A", "入間市OLC")];
    const members: ExistingMemberRef[] = [
      { id: "member-1", athleteKey: normalizeNameKey("田中一郎") },
    ];
    const detected = detectClubEntries(entries, joeClubNames, members);
    expect(detected).toHaveLength(1);
    expect(detected[0].memberId).toBe("member-1");
    expect(detected[0].alreadyRegistered).toBe(true);
  });

  it("leaves memberId null & alreadyRegistered=false for a non-matching member", () => {
    const entries = [entry("田中一郎", "M21A", "入間市OLC")];
    const members: ExistingMemberRef[] = [
      { id: "member-1", athleteKey: normalizeNameKey("別人花子") },
    ];
    const detected = detectClubEntries(entries, joeClubNames, members);
    expect(detected).toHaveLength(1);
    expect(detected[0].memberId).toBeNull();
    expect(detected[0].alreadyRegistered).toBe(false);
  });

  // --- 指摘1: displayName フォールバック突合（名前の重複防止） ---

  it("falls back to normalizeNameKey(displayName) when athleteKey is null", () => {
    // 自己登録で athlete_key を持たない member でも、表示名から同一人物を拾える。
    const entries = [entry("田中一郎", "M21A", "入間市OLC")];
    const members: ExistingMemberRef[] = [
      { id: "member-1", athleteKey: null, displayName: "田中一郎" },
    ];
    const detected = detectClubEntries(entries, joeClubNames, members);
    expect(detected).toHaveLength(1);
    expect(detected[0].memberId).toBe("member-1");
    expect(detected[0].alreadyRegistered).toBe(true);
  });

  it("matches displayName fallback across spacing/width differences (NFKC + space strip)", () => {
    // エントリー「田中一郎」 vs 自己登録の表示名「田中 一郎」（全角スペース）は同一視。
    const entries = [entry("田中一郎", "M21A", "入間市OLC")];
    const members: ExistingMemberRef[] = [
      { id: "member-1", athleteKey: null, displayName: "田中　一郎" },
    ];
    const detected = detectClubEntries(entries, joeClubNames, members);
    expect(detected[0].memberId).toBe("member-1");
  });

  it("prefers athleteKey match over a different displayName-key member", () => {
    // 同じエントリーに、athleteKey 一致の member と displayName 一致の member が両方居る場合は
    // athleteKey 一致を優先する。
    const entries = [entry("田中一郎", "M21A", "入間市OLC")];
    const members: ExistingMemberRef[] = [
      { id: "by-name", athleteKey: null, displayName: "田中一郎" },
      { id: "by-key", athleteKey: normalizeNameKey("田中一郎"), displayName: "別表示" },
    ];
    const detected = detectClubEntries(entries, joeClubNames, members);
    expect(detected[0].memberId).toBe("by-key");
  });

  it("does not match when neither athleteKey nor displayName key matches", () => {
    const entries = [entry("田中一郎", "M21A", "入間市OLC")];
    const members: ExistingMemberRef[] = [
      { id: "member-1", athleteKey: null, displayName: "別人花子" },
    ];
    const detected = detectClubEntries(entries, joeClubNames, members);
    expect(detected[0].memberId).toBeNull();
    expect(detected[0].alreadyRegistered).toBe(false);
  });

  it("returns [] when joeClubNames is empty", () => {
    const entries = [entry("山田太郎", "M21A", "入間市OLC")];
    const detected = detectClubEntries(entries, [], []);
    expect(detected).toEqual([]);
  });
});

describe("collectEntriesForEvent", () => {
  const makeRef = (joeEventId: number, className: string, affiliation: string): AthleteEntryRef => ({
    joe_event_id: joeEventId,
    eventName: "テスト大会",
    date: "2026-06-12",
    prefecture: "埼玉県",
    className,
    affiliation,
    entryStatus: "open",
    joeUrl: "https://example.com",
    totalEntries: 10,
  });

  it("filters entries to the target joe_event_id only", () => {
    const index: EntryIndex = {
      generatedAt: "2026-06-12T00:00:00.000Z",
      targetEventCount: 2,
      scrapedEventCount: 2,
      athletes: {
        [normalizeNameKey("山田太郎")]: [
          makeRef(100, "M21A", "入間市OLC"),
          makeRef(200, "M21A", "入間市OLC"),
        ],
        [normalizeNameKey("佐藤花子")]: [makeRef(200, "W21A", "練馬OLC")],
      },
    };

    const collected = collectEntriesForEvent(index, 100);
    expect(collected).toHaveLength(1);
    expect(collected[0].nameKey).toBe(normalizeNameKey("山田太郎"));
    expect(collected[0].className).toBe("M21A");
    expect(collected[0].affiliation).toBe("入間市OLC");
  });
});
