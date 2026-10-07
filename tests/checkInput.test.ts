import { describe, it, expect } from "vitest";
import { normalizeDomain } from "../server/utils/domain";
import {
  buildCheckRows,
  CheckInputError,
  parseCsvUrls,
  parseDomainList,
  planUrlRows,
  resultsDisplay,
} from "../server/utils/checkInput";
import type { DomainCacheRow } from "../supabase/functions/_shared/cache";

const now = new Date("2026-10-07T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const domainsN = (n: number) => Array.from({ length: n }, (_, i) => `site${i}.com`);

describe("normalizeDomain", () => {
  it("strips scheme, www, path, query and port, and lowercases", () => {
    expect(normalizeDomain("https://www.Example.com/page?x=1")).toBe("example.com");
    expect(normalizeDomain("example.com:8080")).toBe("example.com");
  });

  it("keeps subdomains other than www", () => {
    expect(normalizeDomain("blog.example.com")).toBe("blog.example.com");
  });

  it("rejects hosts without a dot and unparseable input", () => {
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("parseDomainList", () => {
  it("splits on newlines and commas and drops blanks", () => {
    expect(parseDomainList("a.com, b.com\nc.com\r\n\n,,")).toEqual(["a.com", "b.com", "c.com"]);
  });
});

describe("parseCsvUrls", () => {
  it("handles an Excel export: BOM, CRLF and a quoted URL header", () => {
    const csv = '﻿"URL",notes\r\n"https://a.com/x",hi\r\nb.com,\r\n';
    expect(parseCsvUrls(csv)).toEqual(["https://a.com/x", "b.com"]);
  });

  it("treats a headerless file as all data, first column only", () => {
    expect(parseCsvUrls("a.com,foo\nb.com")).toEqual(["a.com", "b.com"]);
  });

  it("does not let a BOM become part of the first domain", () => {
    expect(parseCsvUrls("﻿a.com\nb.com")).toEqual(["a.com", "b.com"]);
  });
});

describe("buildCheckRows", () => {
  it("normalizes, keeps duplicates as separate rows, and counts skipped", () => {
    const { rows, skipped } = buildCheckRows(["a.com", "https://www.a.com/x", "localhost"], 100);
    expect(rows).toEqual([
      { original_url: "a.com", domain: "a.com" },
      { original_url: "https://www.a.com/x", domain: "a.com" },
    ]);
    expect(skipped).toBe(1);
  });

  it("throws when nothing valid remains", () => {
    expect(() => buildCheckRows(parseDomainList(",, \n localhost\n not a domain"), 100)).toThrow(
      CheckInputError,
    );
    expect(() => buildCheckRows([], 100)).toThrow("No valid domains found");
  });

  it("enforces the cap on valid rows only", () => {
    expect(buildCheckRows(domainsN(100), 100).rows).toHaveLength(100);
    expect(buildCheckRows([...domainsN(100), "junk", "localhost"], 100).skipped).toBe(2);
    expect(() => buildCheckRows(domainsN(101), 100)).toThrow("Max 100 domains per check");
  });
});

describe("planUrlRows", () => {
  const cache: DomainCacheRow[] = [
    { domain: "fresh.com", dr: 55, status: "ok", checked_at: daysAgo(3) },
    { domain: "zero.com", dr: 0, status: "ok", checked_at: daysAgo(3) },
    { domain: "stale.com", dr: 40, status: "ok", checked_at: daysAgo(31) },
    { domain: "nodata.com", dr: null, status: "no_data", checked_at: daysAgo(2) },
    { domain: "oldnodata.com", dr: null, status: "no_data", checked_at: daysAgo(8) },
  ];
  const row = (domain: string) => ({ original_url: domain, domain });

  it("resolves fresh hits and queues stale, expired and unknown domains", () => {
    const { planned, resolved } = planUrlRows(
      ["fresh.com", "zero.com", "stale.com", "nodata.com", "oldnodata.com", "new.com"].map(row),
      cache,
      now,
    );
    expect(planned.map((p) => [p.domain, p.status, p.source, p.dr])).toEqual([
      ["fresh.com", "done", "cache", 55],
      ["zero.com", "done", "cache", 0],
      ["stale.com", "pending", null, null],
      ["nodata.com", "error", "no_data", null],
      ["oldnodata.com", "pending", null, null],
      ["new.com", "pending", null, null],
    ]);
    expect(resolved).toBe(3);
  });

  it("resolves every row of a duplicated domain and counts rows, not domains", () => {
    const { planned, resolved } = planUrlRows(
      [{ original_url: "fresh.com", domain: "fresh.com" }, { original_url: "https://www.fresh.com/x", domain: "fresh.com" }],
      cache,
      now,
    );
    expect(planned.every((p) => p.status === "done")).toBe(true);
    expect(resolved).toBe(2);
  });
});

describe("resultsDisplay", () => {
  it("shows typed checks of up to 10 rows inline, everything else on a page", () => {
    expect(resultsDisplay("typed", 10)).toBe("inline");
    expect(resultsDisplay("typed", 11)).toBe("page");
    expect(resultsDisplay("csv", 1)).toBe("page");
  });
});
