import { describe, it, expect } from "vitest";
import { metaErrorFields, metaSuccessFields, staleFaviconPath } from "../supabase/functions/fetch-meta/metaOutcome";

const NOW = "2026-10-10T12:00:00.000Z";

describe("meta outcome fields", () => {
  it("success finishes the claim: clears claimed_at and resets attempts", () => {
    expect(metaSuccessFields({ title: "T", description: null }, "x.com.png", NOW)).toEqual({
      title: "T",
      description: null,
      favicon_path: "x.com.png",
      status: "ok",
      error: null,
      fetched_at: NOW,
      claimed_at: null,
      attempts: 0,
    });
  });

  it("error finishes the claim too, so a failure is never re-claimed every 2 minutes", () => {
    expect(metaErrorFields("blocked: blocked address 10.0.0.1", NOW)).toEqual({
      status: "error",
      error: "blocked: blocked address 10.0.0.1",
      fetched_at: NOW,
      claimed_at: null,
      attempts: 0,
    });
  });

  it("caps the stored error text at 200 characters", () => {
    expect(metaErrorFields("x".repeat(500), NOW).error).toHaveLength(200);
  });
});

describe("staleFaviconPath", () => {
  it("returns the previous object to delete only when the path changed", () => {
    expect(staleFaviconPath("x.com.png", "x.com.ico")).toBe("x.com.png");
    expect(staleFaviconPath("x.com.png", null)).toBe("x.com.png");
    expect(staleFaviconPath("x.com.png", "x.com.png")).toBeNull();
    expect(staleFaviconPath(null, "x.com.ico")).toBeNull();
  });
});
