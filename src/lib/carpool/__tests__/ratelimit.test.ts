import { describe, it, expect } from "vitest";
import { isRateLimited } from "../api/helpers";
import { RATE_LIMIT_MAX_WRITES } from "../api/constants";

describe("isRateLimited (pure)", () => {
  it("allows count == max (boundary inclusive)", () => {
    expect(isRateLimited(100, 100)).toBe(false);
  });

  it("blocks count just above max", () => {
    expect(isRateLimited(101, 100)).toBe(true);
  });

  it("allows zero writes", () => {
    expect(isRateLimited(0, 100)).toBe(false);
  });

  it("uses RATE_LIMIT_MAX_WRITES as default max", () => {
    expect(isRateLimited(RATE_LIMIT_MAX_WRITES)).toBe(false);
    expect(isRateLimited(RATE_LIMIT_MAX_WRITES + 1)).toBe(true);
  });
});
