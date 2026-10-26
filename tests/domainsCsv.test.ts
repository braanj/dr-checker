import { describe, expect, it } from "vitest";
import {
  buildDomainsCsv,
  csvCell,
  exportFilename,
  ExportInputError,
  parseExportBody,
} from "../server/utils/domainsCsv";

describe("parseExportBody", () => {
  it("normalizes, dedupes and drops invalid entries", () => {
    expect(
      parseExportBody({ domains: ["www.A.com", "a.com", "https://b.org/x", "nodot", 5] }),
    ).toEqual(["a.com", "b.org"]);
  });
  it("rejects when nothing is valid", () => {
    expect(() => parseExportBody({ domains: ["nodot"] })).toThrow("No valid domains to export");
  });
  it("rejects a malformed body", () => {
    expect(() => parseExportBody({})).toThrow("Expected JSON { domains: string[] }");
    expect(() => parseExportBody(null)).toThrow(ExportInputError);
  });
  it("caps distinct domains at 1000", () => {
    const many = Array.from({ length: 1001 }, (_, i) => `d${i}.com`);
    expect(() => parseExportBody({ domains: many })).toThrow("At most 1000 domains per export");
  });
  it("counts after dedupe", () => {
    const dup = [...Array.from({ length: 1000 }, (_, i) => `d${i}.com`), "d0.com"];
    expect(parseExportBody({ domains: dup })).toHaveLength(1000);
  });
});

describe("csvCell", () => {
  it("quotes and escapes", () => {
    expect(csvCell('Acme, "Best" Co')).toBe('"Acme, ""Best"" Co"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
  it("guards formulas in strings", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell("\tx")).toBe("'\tx");
  });
  it("leaves numbers and null alone", () => {
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(null)).toBe("");
  });
});

describe("buildDomainsCsv", () => {
  it("emits header and CRLF rows", () => {
    const csv = buildDomainsCsv([
      { domain: "a.com", title: "A", dr: 50, dr_change: null, checked_at: "2026-10-26T00:00:00.000Z", page_url: "https://x/domain/a.com" },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("domain,title,dr,dr_change,checked_at,page_url");
    expect(lines[1]).toBe("a.com,A,50,,2026-10-26T00:00:00.000Z,https://x/domain/a.com");
  });
});

describe("exportFilename", () => {
  it("uses the UTC date", () => {
    expect(exportFilename(new Date("2026-10-26T23:30:00Z"))).toBe("dr-domains-2026-10-26.csv");
  });
});
