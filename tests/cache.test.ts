import { describe, it, expect } from "vitest";
import { cachedUrlFields, isFresh, NO_DATA_MESSAGE } from "../supabase/functions/_shared/cache";

const now = new Date("2026-10-07T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe("isFresh", () => {
  it("keeps ok rows fresh for under 30 days", () => {
    expect(isFresh({ status: "ok", checked_at: daysAgo(29) }, now)).toBe(true);
    expect(isFresh({ status: "ok", checked_at: daysAgo(30) }, now)).toBe(false);
  });

  it("keeps no_data rows fresh for under 7 days", () => {
    expect(isFresh({ status: "no_data", checked_at: daysAgo(6) }, now)).toBe(true);
    expect(isFresh({ status: "no_data", checked_at: daysAgo(7) }, now)).toBe(false);
  });
});

describe("cachedUrlFields", () => {
  it("maps an ok row to done/cache, including DR 0", () => {
    expect(
      cachedUrlFields({ domain: "a.com", dr: 0, status: "ok", checked_at: daysAgo(1) }),
    ).toEqual({ status: "done", dr: 0, source: "cache", checked_at: daysAgo(1), error_message: null });
  });

  it("maps a no_data row to error/no_data", () => {
    expect(
      cachedUrlFields({ domain: "a.com", dr: null, status: "no_data", checked_at: daysAgo(1) }),
    ).toEqual({
      status: "error",
      dr: null,
      source: "no_data",
      checked_at: daysAgo(1),
      error_message: NO_DATA_MESSAGE,
    });
  });
});
