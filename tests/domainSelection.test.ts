import { describe, expect, it } from "vitest";
import {
  SELECTION_KEY,
  loadSelection,
  pageCheckState,
  saveSelection,
  setPage,
  toggleDomain,
} from "../utils/domainSelection";

const many = (n: number, p = "d") => Array.from({ length: n }, (_, i) => `${p}${i}.com`);

describe("loadSelection", () => {
  it("returns empty for null storage", () => expect(loadSelection(null).size).toBe(0));
  it("returns empty when getItem throws", () => {
    const s = { getItem: () => { throw new Error("no"); } };
    expect(loadSelection(s).size).toBe(0);
  });
  it("returns empty for bad JSON", () => expect(loadSelection({ getItem: () => "{bad" }).size).toBe(0));
  it("returns empty for a non-array", () => expect(loadSelection({ getItem: () => '{"a":1}' }).size).toBe(0));
  it("keeps only strings", () => {
    expect([...loadSelection({ getItem: () => '["a.com",5,"b.org"]' })]).toEqual(["a.com", "b.org"]);
  });
  it("caps at 1000", () => {
    const sel = loadSelection({ getItem: () => JSON.stringify(many(1500)) });
    expect(sel.size).toBe(1000);
    expect(sel.has("d0.com")).toBe(true);
    expect(sel.has("d999.com")).toBe(true);
    expect(sel.has("d1000.com")).toBe(false);
  });
  it("reads the documented key", () => {
    let key = "";
    loadSelection({ getItem: (k) => { key = k; return null; } });
    expect(key).toBe(SELECTION_KEY);
  });
});

describe("saveSelection", () => {
  it("writes JSON under the key", () => {
    const calls: string[][] = [];
    saveSelection({ setItem: (k, v) => { calls.push([k, v]); } }, new Set(["a.com"]));
    expect(calls).toEqual([[SELECTION_KEY, '["a.com"]']]);
  });
  it("swallows errors and null storage", () => {
    expect(() => saveSelection({ setItem: () => { throw new Error("full"); } }, new Set(["a"]))).not.toThrow();
    expect(() => saveSelection(null, new Set())).not.toThrow();
  });
});

describe("toggleDomain", () => {
  it("adds then removes without mutating", () => {
    const a = new Set<string>();
    const b = toggleDomain(a, "x.com");
    expect(b.sel.has("x.com")).toBe(true);
    expect(b.capped).toBe(false);
    expect(a.size).toBe(0);
    expect(toggleDomain(b.sel, "x.com").sel.size).toBe(0);
  });
  it("caps at 1000 but still removes", () => {
    const full = new Set(many(1000));
    const r = toggleDomain(full, "new.com");
    expect(r.capped).toBe(true);
    expect(r.sel.size).toBe(1000);
    expect(r.sel.has("new.com")).toBe(false);
    const rm = toggleDomain(full, "d5.com");
    expect(rm.sel.size).toBe(999);
    expect(rm.capped).toBe(false);
  });
});

describe("setPage", () => {
  it("adds page domains up to the cap", () => {
    const start = new Set(many(995, "o"));
    const r = setPage(start, many(10), true);
    expect(r.sel.size).toBe(1000);
    expect(r.capped).toBe(true);
    expect(start.size).toBe(995);
  });
  it("adds all when room", () => {
    const r = setPage(new Set(["o.com"]), ["a.com", "b.com"], true);
    expect(r.sel.size).toBe(3);
    expect(r.capped).toBe(false);
  });
  it("off removes only page domains", () => {
    const r = setPage(new Set(["a.com", "b.com", "o.com"]), ["a.com", "b.com"], false);
    expect([...r.sel]).toEqual(["o.com"]);
    expect(r.capped).toBe(false);
  });
});

describe("pageCheckState", () => {
  const sel = new Set(["a.com", "b.com"]);
  it("none", () => expect(pageCheckState(sel, ["c.com"])).toBe("none"));
  it("some", () => expect(pageCheckState(sel, ["a.com", "c.com"])).toBe("some"));
  it("all", () => expect(pageCheckState(sel, ["a.com", "b.com"])).toBe("all"));
  it("empty page is none", () => expect(pageCheckState(sel, [])).toBe("none"));
});
