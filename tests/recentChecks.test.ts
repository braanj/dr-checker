import { describe, expect, it } from "vitest";
import {
  RECENT_KEY,
  RECENT_MAX,
  addRecent,
  readRecent,
  recentEntry,
  recentHref,
  recentLabel,
  writeRecent,
  type RecentCheck,
} from "../utils/recentChecks";

const NOW = new Date("2026-10-28T00:00:00.000Z");
const entry = (id: string, inline = true, createdAt = "2026-10-26T00:00:00.000Z"): RecentCheck => ({
  batchId: id,
  createdAt,
  total: 2,
  label: "a.com +1 more",
  inline,
});

describe("readRecent", () => {
  it("returns [] for null storage", () => {
    expect(readRecent(null)).toEqual([]);
  });
  it("returns [] when getItem throws", () => {
    const s = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(readRecent(s)).toEqual([]);
  });
  it("returns [] for invalid JSON", () => {
    const s = { getItem: () => "not json", setItem: () => {}, removeItem: () => {} };
    expect(readRecent(s)).toEqual([]);
  });
  it("keeps only valid entries", () => {
    const raw = JSON.stringify([entry("a"), { foo: 1 }]);
    const s = { getItem: (k: string) => (k === RECENT_KEY ? raw : null), setItem: () => {}, removeItem: () => {} };
    expect(readRecent(s, NOW)).toEqual([entry("a")]);
  });
  it("drops checks whose results the server has already deleted", () => {
    const old = entry("old", true, "2026-10-20T23:59:59.000Z"); // just over 7 days before NOW
    const raw = JSON.stringify([entry("a"), old]);
    const s = { getItem: () => raw, setItem: () => {}, removeItem: () => {} };
    expect(readRecent(s, NOW).map((e) => e.batchId)).toEqual(["a"]);
  });
});

describe("addRecent", () => {
  it("moves a re-added batchId to the front without duplicating", () => {
    const out = addRecent([entry("a"), entry("b")], entry("b"));
    expect(out.map((e) => e.batchId)).toEqual(["b", "a"]);
  });
  it("caps at 20 and drops the oldest", () => {
    let list: RecentCheck[] = [];
    for (let i = 0; i < 21; i++) list = addRecent(list, entry(`id${i}`));
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].batchId).toBe("id20");
    expect(list.some((e) => e.batchId === "id0")).toBe(false);
  });
});

describe("recentLabel", () => {
  it("summarises typed input", () => {
    expect(recentLabel({ typed: " a.com, b.org\nc.net", total: 3 })).toBe("a.com +2 more");
  });
  it("shows a single typed domain", () => {
    expect(recentLabel({ typed: "a.com", total: 1 })).toBe("a.com");
  });
  it("uses the csv name", () => {
    expect(recentLabel({ csvName: "list.csv", total: 500 })).toBe("list.csv");
  });
});

describe("recentHref", () => {
  it("builds both shapes", () => {
    expect(recentHref(entry("x", true))).toBe("/?check=x");
    expect(recentHref(entry("x", false))).toBe("/results/x");
  });
});

describe("recentEntry", () => {
  it("records a typed check with its label and display", () => {
    expect(
      recentEntry({ typed: "a.com, b.com" }, { batchId: "x", total: 2, display: "inline" }, "2026-10-26T00:00:00.000Z"),
    ).toEqual(entry("x", true));
  });
  it("labels a csv check by file name and opens it on the results page", () => {
    const e = recentEntry({ csvName: "list.csv" }, { batchId: "y", total: 500, display: "page" }, "t");
    expect(e).toMatchObject({ label: "list.csv", total: 500, inline: false });
  });
});

describe("writeRecent", () => {
  it("swallows setItem errors", () => {
    const s = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    expect(() => writeRecent(s, [entry("a")])).not.toThrow();
    expect(() => writeRecent(null, [])).not.toThrow();
  });
});
