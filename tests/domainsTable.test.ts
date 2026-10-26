import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATE,
  drBand,
  formatDelta,
  nextSort,
  pageRange,
  parseDomainsRoute,
  toRouteQuery,
} from "../utils/domainsTable";

describe("drBand", () => {
  it("bands", () => {
    expect(drBand(29.9)).toBe("low");
    expect(drBand(30)).toBe("mid");
    expect(drBand(59)).toBe("mid");
    expect(drBand(60)).toBe("high");
    expect(drBand(80)).toBe("top");
    expect(drBand(100)).toBe("top");
  });
});

describe("formatDelta", () => {
  it("formats", () => {
    expect(formatDelta(3)).toEqual({ text: "+3", dir: "up", label: "Up 3 since previous check" });
    expect(formatDelta(-1.4)).toEqual({ text: "−1", dir: "down", label: "Down 1 since previous check" });
    expect(formatDelta(0.2)).toEqual({ text: "0", dir: "flat", label: "No change since previous check" });
    expect(formatDelta(null)).toEqual({ text: "—", dir: "none", label: "No previous check" });
  });
});

describe("pageRange", () => {
  it("ranges", () => {
    expect(pageRange(1, 1)).toEqual([1]);
    expect(pageRange(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageRange(1, 65)).toEqual([1, 2, 3, "…", 65]);
    expect(pageRange(33, 65)).toEqual([1, "…", 32, 33, 34, "…", 65]);
    expect(pageRange(65, 65)).toEqual([1, "…", 63, 64, 65]);
  });
});

describe("route state", () => {
  it("defaults", () => {
    expect(parseDomainsRoute({})).toEqual(DEFAULT_STATE);
    expect(toRouteQuery(DEFAULT_STATE)).toEqual({});
  });
  it("invalid values fall back", () => {
    expect(
      parseDomainsRoute({ pageSize: "37", sortBy: "foo", sortDir: "up", page: "-2", drMin: "abc" }),
    ).toEqual(DEFAULT_STATE);
  });
  it("caps absurd page numbers", () => {
    expect(parseDomainsRoute({ page: "99999999999999999999" }).page).toBe(1);
    expect(parseDomainsRoute({ page: "100001" }).page).toBe(1);
    expect(parseDomainsRoute({ page: "100000" }).page).toBe(100000);
  });
  it("round-trips", () => {
    const q = { pageSize: "100", sortBy: "dr_change", sortDir: "asc", page: "3", tld: "io" };
    expect(toRouteQuery(parseDomainsRoute(q))).toEqual(q);
  });
});

describe("nextSort", () => {
  it("flips current column", () => {
    expect(nextSort({ ...DEFAULT_STATE, sortBy: "dr", sortDir: "desc", page: 4 }, "dr")).toEqual({
      sortBy: "dr", sortDir: "asc", page: 1,
    });
  });
  it("new column defaults", () => {
    expect(nextSort(DEFAULT_STATE, "domain")).toEqual({ sortBy: "domain", sortDir: "asc", page: 1 });
    expect(nextSort(DEFAULT_STATE, "dr")).toEqual({ sortBy: "dr", sortDir: "desc", page: 1 });
    expect(nextSort(DEFAULT_STATE, "dr_change")).toEqual({ sortBy: "dr_change", sortDir: "desc", page: 1 });
  });
});
