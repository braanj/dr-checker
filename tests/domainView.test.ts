import { describe, it, expect } from "vitest";
import { domainSeo, sparklinePath, type DomainView } from "../utils/domainView";
import { checkedAgo } from "../utils/checkedAgo";

const view: DomainView = {
  domain: "example.com",
  dr: 91.6,
  checked_at: "2026-10-01T12:00:00Z",
  history: [],
  meta: null,
};

describe("domainSeo", () => {
  it("builds title, description and canonical URL from the DR", () => {
    expect(domainSeo(view, "https://dr-bulkchecker.netlify.app")).toEqual({
      title: "example.com Domain Rating (DR 92) | DR Checker",
      description: "example.com has an Ahrefs Domain Rating of 92 (checked 2026-10-01).",
      canonical: "https://dr-bulkchecker.netlify.app/domain/example.com",
    });
  });

  it("appends the site description and caps the result at 300 characters", () => {
    const seo = domainSeo({ ...view, meta: { title: null, description: "x".repeat(400), favicon_url: null } }, "https://s");
    expect(seo.description.startsWith("example.com has an Ahrefs Domain Rating of 92 (checked 2026-10-01). xxx")).toBe(true);
    expect(seo.description.length).toBe(300);
    expect(seo.description.endsWith("…")).toBe(true);
  });
});

describe("sparklinePath", () => {
  it("is empty for fewer than two points", () => {
    expect(sparklinePath([], 100, 20)).toBe("");
    expect(sparklinePath([50], 100, 20)).toBe("");
  });

  it("scales oldest-to-newest values across the box, higher DR drawn higher", () => {
    expect(sparklinePath([10, 20, 30], 100, 20)).toBe("M0,20 L50,10 L100,0");
  });

  it("draws a flat line through the middle when all values are equal", () => {
    expect(sparklinePath([40, 40], 100, 20)).toBe("M0,10 L100,10");
  });
});

describe("checkedAgo", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  it("says today, 1 day ago, or N days ago", () => {
    expect(checkedAgo("2026-10-10T08:00:00Z", now)).toBe("today");
    expect(checkedAgo("2026-10-09T08:00:00Z", now)).toBe("1 day ago");
    expect(checkedAgo("2026-09-30T12:00:00Z", now)).toBe("10 days ago");
  });
});
