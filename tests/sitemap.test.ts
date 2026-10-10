import { describe, it, expect } from "vitest";
import { buildRobots, buildSitemap, fetchAllOkDomains } from "../server/utils/sitemap";

describe("buildSitemap", () => {
  it("lists static pages and every domain with lastmod, XML-escaped", () => {
    const xml = buildSitemap("https://s.test", [{ domain: "a&b.com", checked_at: "2026-10-01T12:00:00Z" }]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<loc>https://s.test/</loc>");
    expect(xml).toContain("<loc>https://s.test/docs</loc>");
    expect(xml).toContain("<url><loc>https://s.test/domain/a&amp;b.com</loc><lastmod>2026-10-01</lastmod></url>");
  });
});

describe("buildRobots", () => {
  it("allows pages, hides api/results, points at the sitemap", () => {
    expect(buildRobots("https://s.test")).toBe(
      "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /results/\nSitemap: https://s.test/sitemap.xml\n",
    );
  });
});

describe("fetchAllOkDomains", () => {
  it("pages past the 1,000-row cap until a short page", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => ({ domain: `d${i}.com`, checked_at: "2026-10-01T00:00:00Z" }));
    const ranges: [number, number][] = [];
    const fake = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              range: async (from: number, to: number) => {
                ranges.push([from, to]);
                return { data: all.slice(from, Math.min(to + 1, from + 1000)), error: null };
              },
            }),
          }),
        }),
      }),
    };
    const rows = await fetchAllOkDomains(fake as never, 1000);
    expect(rows).toHaveLength(2500);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999], [2500, 3499]]);
  });
});

describe("fetchAllOkDomains with a smaller server-side row cap", () => {
  it("keeps paging after a short page and stops only on an empty one", async () => {
    const all = Array.from({ length: 1000 }, (_, i) => ({ domain: `d${i}.com`, checked_at: "2026-10-01T00:00:00Z" }));
    const fake = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              // server caps every response at 400 rows regardless of the range asked for
              range: async (from: number, to: number) => ({ data: all.slice(from, Math.min(to + 1, from + 400)), error: null }),
            }),
          }),
        }),
      }),
    };
    expect(await fetchAllOkDomains(fake as never, 1000)).toHaveLength(1000);
  });
});
