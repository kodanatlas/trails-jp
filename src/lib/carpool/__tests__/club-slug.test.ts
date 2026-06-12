import { describe, it, expect } from "vitest";
import {
  generateClubSlug,
  retryClubSlug,
  hashSlugSuffix,
} from "../club-slug";

/** サーバの slug 制約（schemas.ts の clubCreateSchema と同じ）。 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

describe("generateClubSlug (R2: slug 自動生成)", () => {
  it("kebab-joins ASCII runs and lowercases", () => {
    expect(generateClubSlug("Trails Tokyo Club")).toBe("trails-tokyo-club");
  });

  it("appends a hash suffix when the base is 3 chars or shorter (例: 入間市OLC)", () => {
    const slug = generateClubSlug("入間市OLC");
    expect(slug).toMatch(/^olc-[0-9a-z]{4}$/);
  });

  it("gives different suffixes to different OLC clubs (uniqueness)", () => {
    expect(generateClubSlug("入間市OLC")).not.toBe(generateClubSlug("上尾OLC"));
  });

  it("is deterministic for the same name", () => {
    expect(generateClubSlug("入間市OLC")).toBe(generateClubSlug("入間市OLC"));
  });

  it("folds full-width alphanumerics via NFKC (ＯＬＣ → olc)", () => {
    expect(generateClubSlug("入間市ＯＬＣ")).toBe(generateClubSlug("入間市OLC"));
  });

  it("falls back to club-<hash> when the name has no ASCII", () => {
    const slug = generateClubSlug("トレイルズ");
    expect(slug).toMatch(/^club-[0-9a-z]{4}$/);
  });

  it("always satisfies the server slug constraints (pattern / 2..40 chars)", () => {
    const names = [
      "入間市OLC",
      "Trails Tokyo Club",
      "トレイルズ",
      "A B C D E F G H I J K L M N O P Q R S T U V W X Y Z 0123456789",
      "x",
      "ＯＬ123Club",
    ];
    for (const n of names) {
      const slug = generateClubSlug(n);
      expect(slug).toMatch(SLUG_RE);
      expect(slug.length).toBeGreaterThanOrEqual(2);
      expect(slug.length).toBeLessThanOrEqual(40);
    }
  });

  it("caps long names within the limit", () => {
    const slug = generateClubSlug("Super Ultra Mega Long Orienteering Club Name Tokyo Japan");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).toMatch(SLUG_RE);
  });
});

describe("retryClubSlug (409 リトライ)", () => {
  it("appends a salt-derived suffix and stays within constraints", () => {
    const base = generateClubSlug("Trails Tokyo Club");
    const retried = retryClubSlug(base, "1718000000000");
    expect(retried).toMatch(SLUG_RE);
    expect(retried).not.toBe(base);
    expect(retried.startsWith("trails-tokyo-club")).toBe(true);
    expect(retried.length).toBeLessThanOrEqual(40);
  });

  it("different salts give different slugs", () => {
    expect(retryClubSlug("olc-ab12", "salt1")).not.toBe(
      retryClubSlug("olc-ab12", "salt2"),
    );
  });
});

describe("hashSlugSuffix", () => {
  it("returns 4 base36 chars and is deterministic", () => {
    const h = hashSlugSuffix("入間市OLC");
    expect(h).toMatch(/^[0-9a-z]{4}$/);
    expect(hashSlugSuffix("入間市OLC")).toBe(h);
  });
});
