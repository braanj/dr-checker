import { describe, it, expect } from "vitest";
import {
  cacheWriteFor,
  GAVE_UP_MESSAGE,
  historyWriteFor,
  isExhausted,
  classifyAhrefsResponse,
  urlUpdateFor,
} from "../supabase/functions/process-queue/outcome";
import { NO_DATA_MESSAGE, type DomainCacheRow } from "../supabase/functions/_shared/cache";

const now = new Date("2026-10-07T12:00:00Z");
const staleOk: DomainCacheRow = { domain: "a.com", dr: 40, status: "ok", checked_at: "2026-08-01T00:00:00.000Z" };
const transient = { kind: "transient", error: "Ahrefs HTTP 429" } as const;

describe("classifyAhrefsResponse", () => {
  it("reads nested and flat DR shapes, including 0", () => {
    expect(classifyAhrefsResponse(200, { domain_rating: { domain_rating: 71 } })).toEqual({ kind: "ok", dr: 71 });
    expect(classifyAhrefsResponse(200, { domain_rating: 12.5 })).toEqual({ kind: "ok", dr: 12.5 });
    expect(classifyAhrefsResponse(200, { domain_rating: { domain_rating: 0 } })).toEqual({ kind: "ok", dr: 0 });
  });

  it("treats a 200 without a numeric DR as no_data", () => {
    expect(classifyAhrefsResponse(200, {})).toEqual({ kind: "no_data" });
    expect(classifyAhrefsResponse(200, null)).toEqual({ kind: "no_data" });
  });

  it("treats any non-200 as transient", () => {
    expect(classifyAhrefsResponse(429, null)).toEqual({ kind: "transient", error: "Ahrefs HTTP 429" });
    expect(classifyAhrefsResponse(503, null)).toEqual({ kind: "transient", error: "Ahrefs HTTP 503" });
  });
});

describe("cacheWriteFor", () => {
  it("caches ok and no_data, never transient", () => {
    expect(cacheWriteFor({ kind: "ok", dr: 5 })).toEqual({ dr: 5, status: "ok" });
    expect(cacheWriteFor({ kind: "no_data" })).toEqual({ dr: null, status: "no_data" });
    expect(cacheWriteFor(transient)).toBeNull();
  });
});

describe("urlUpdateFor", () => {
  it("marks a live DR as done/live", () => {
    expect(urlUpdateFor({ kind: "ok", dr: 5 }, 1, null, now)).toEqual({
      status: "done",
      dr: 5,
      source: "live",
      checked_at: now.toISOString(),
      error_message: null,
    });
  });

  it("marks no_data as error/no_data", () => {
    expect(urlUpdateFor({ kind: "no_data" }, 1, null, now)).toEqual({
      status: "error",
      dr: null,
      source: "no_data",
      checked_at: now.toISOString(),
      error_message: NO_DATA_MESSAGE,
    });
  });

  it("requeues transient failures with 30s x attempts backoff", () => {
    expect(urlUpdateFor(transient, 1, null, now)).toEqual({
      status: "pending",
      available_at: "2026-10-07T12:00:30.000Z",
      error_message: "Ahrefs HTTP 429",
    });
    expect(urlUpdateFor(transient, 2, null, now)).toMatchObject({ available_at: "2026-10-07T12:01:00.000Z" });
  });

  it("falls back to a stale DR once attempts are used up", () => {
    expect(urlUpdateFor(transient, 3, staleOk, now)).toEqual({
      status: "done",
      dr: 40,
      source: "stale",
      checked_at: staleOk.checked_at,
      error_message: null,
    });
  });

  it("errors once attempts are used up and there is no stale DR, even past the max", () => {
    const noData: DomainCacheRow = { domain: "a.com", dr: null, status: "no_data", checked_at: staleOk.checked_at };
    for (const previous of [null, noData]) {
      expect(urlUpdateFor(transient, 3, previous, now)).toEqual({
        status: "error",
        dr: null,
        source: null,
        checked_at: null,
        error_message: "Ahrefs HTTP 429",
      });
    }
    expect(urlUpdateFor(transient, 4, null, now)).toMatchObject({ status: "error" });
  });
});

describe("isExhausted", () => {
  it("gives up only once a reclaim pushes attempts past the max", () => {
    expect(isExhausted(3)).toBe(false);
    expect(isExhausted(4)).toBe(true);
  });

  it("finalizes an exhausted row without a fetch: stale DR if known, else error", () => {
    const gaveUp = { kind: "transient", error: GAVE_UP_MESSAGE } as const;
    expect(urlUpdateFor(gaveUp, 4, staleOk, now)).toMatchObject({ status: "done", source: "stale", dr: 40 });
    expect(urlUpdateFor(gaveUp, 4, null, now)).toMatchObject({ status: "error", error_message: GAVE_UP_MESSAGE });
  });
});

describe("historyWriteFor", () => {
  it("records every ok reading, including DR 0", () => {
    expect(historyWriteFor({ kind: "ok", dr: 71 })).toEqual({ dr: 71 });
    expect(historyWriteFor({ kind: "ok", dr: 0 })).toEqual({ dr: 0 });
  });

  it("never records no_data or transient results", () => {
    expect(historyWriteFor({ kind: "no_data" })).toBeNull();
    expect(historyWriteFor({ kind: "transient", error: "Ahrefs HTTP 429" })).toBeNull();
  });
});
