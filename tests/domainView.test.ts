import { describe, it, expect } from "vitest";
import { domainPageState, domainSeo, drPointLabel, formatDelta, formatDr, historyByDay, historyChartPoints, metaViewFrom, nextAutoRecheck, siteBase, sparklinePath, type DomainView } from "../utils/domainView";
import { isoDate } from "../utils/checkedAgo";
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
      title: "example.com Domain Rating (DR 91.6) | DR Checker",
      description: "example.com has an Ahrefs Domain Rating of 91.6 (checked 2026-10-01).",
      canonical: "https://dr-bulkchecker.netlify.app/domain/example.com",
    });
  });

  it("appends the site description and caps the result at 300 characters", () => {
    const seo = domainSeo({ ...view, meta: { title: null, description: "x".repeat(400), favicon_url: null } }, "https://s");
    expect(seo.description.startsWith("example.com has an Ahrefs Domain Rating of 91.6 (checked 2026-10-01). xxx")).toBe(true);
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

describe("domainPageState", () => {
  it("is found when the API returned a view", () => {
    expect(domainPageState(view, null)).toBe("found");
  });

  it("is unknown only for a real 404, or when there is no valid domain at all", () => {
    expect(domainPageState(null, { statusCode: 404 })).toBe("unknown");
    expect(domainPageState(null, null)).toBe("unknown");
  });

  it("is unavailable for any other failure, so a DB blip never serves 404 + noindex", () => {
    expect(domainPageState(null, { statusCode: 500 })).toBe("unavailable");
    expect(domainPageState(null, { statusCode: 503 })).toBe("unavailable");
    expect(domainPageState(null, {})).toBe("unavailable");
  });
});

describe("formatDr / siteBase / isoDate", () => {
  it("formats DR the same way everywhere (one decimal, no trailing .0)", () => {
    expect(formatDr(91.6)).toBe("91.6");
    expect(formatDr(26)).toBe("26");
    expect(formatDr(0.2)).toBe("0.2");
    expect(formatDr(45.55)).toBe("45.6");
    expect(formatDr(12.04)).toBe("12");
    expect(formatDr(0)).toBe("0");
  });

  it("strips trailing slashes from the site URL", () => {
    expect(siteBase("https://s.test/")).toBe("https://s.test");
    expect(siteBase("https://s.test//")).toBe("https://s.test");
    expect(siteBase("https://s.test")).toBe("https://s.test");
    expect(domainSeo(view, "https://s.test/").canonical).toBe("https://s.test/domain/example.com");
  });

  it("renders dates as a locale-independent UTC YYYY-MM-DD", () => {
    expect(isoDate("2026-10-01T23:30:00-02:00")).toBe("2026-10-02");
    expect(isoDate("2026-10-10T12:41:53.168+00:00")).toBe("2026-10-10");
  });
});

describe("metaViewFrom", () => {
  const SUPA = "https://p.supabase.co";
  it("shows the last good metadata even when the latest refresh errored", () => {
    expect(metaViewFrom({ status: "error", title: "T", description: "D", favicon_path: "x.com.png" }, SUPA)).toEqual({
      title: "T",
      description: "D",
      favicon_url: "https://p.supabase.co/storage/v1/object/public/favicons/x.com.png",
    });
  });

  it("is null when there is nothing to show", () => {
    expect(metaViewFrom(null, SUPA)).toBeNull();
    expect(metaViewFrom({ status: "error", title: null, description: null, favicon_path: null }, SUPA)).toBeNull();
  });
});

describe("nextAutoRecheck", () => {
  it("gives the end of the 30-day cache window while the reading is fresh", () => {
    expect(nextAutoRecheck("2026-10-01T12:00:00Z", new Date("2026-10-20T00:00:00Z"))).toBe("2026-10-31");
  });

  it("is null once the reading is stale, so Re-check shows", () => {
    expect(nextAutoRecheck("2026-10-01T12:00:00Z", new Date("2026-10-31T12:00:00Z"))).toBeNull();
  });
});

describe("historyByDay", () => {
  it("keeps the newest reading of each day, newest first", () => {
    const history = [
      { dr: 93, checked_at: "2026-09-16T20:00:00Z" },
      { dr: 92, checked_at: "2026-09-16T10:00:00Z" },
      { dr: 92, checked_at: "2026-09-16T01:00:00Z" },
      { dr: 90, checked_at: "2026-08-16T10:00:00Z" },
    ];
    expect(historyByDay(history)).toEqual([history[0], history[3]]);
  });
});

describe("historyChartPoints", () => {
  it("turns newest-first days into oldest-first points placed at their real time", () => {
    const days = [
      { dr: 47, checked_at: "2026-08-14T09:00:00Z" },
      { dr: 43, checked_at: "2026-07-01T09:00:00Z" },
      { dr: 44, checked_at: "2026-06-30T09:00:00Z" },
    ];
    expect(historyChartPoints(days)).toEqual([
      { x: Date.UTC(2026, 5, 30, 9), y: 44 },
      { x: Date.UTC(2026, 6, 1, 9), y: 43 },
      { x: Date.UTC(2026, 7, 14, 9), y: 47 },
    ]);
  });
});

describe("formatDelta", () => {
  it("formats", () => {
    expect(formatDelta(3)).toEqual({ text: "+3", dir: "up", label: "Up 3 since previous check" });
    expect(formatDelta(-1.4)).toEqual({ text: "−1.4", dir: "down", label: "Down 1.4 since previous check" });
    expect(formatDelta(0.2)).toEqual({ text: "+0.2", dir: "up", label: "Up 0.2 since previous check" });
    expect(formatDelta(0.04)).toEqual({ text: "0", dir: "flat", label: "No change since previous check" });
    expect(formatDelta(-0.04)).toEqual({ text: "0", dir: "flat", label: "No change since previous check" });
    expect(formatDelta(0)).toEqual({ text: "0", dir: "flat", label: "No change since previous check" });
    expect(formatDelta(null)).toEqual({ text: "—", dir: "none", label: "No previous check" });
  });

  it("does not leak float subtraction noise", () => {
    expect(formatDelta(2.3 - 2.5)).toEqual({ text: "−0.2", dir: "down", label: "Down 0.2 since previous check" });
    expect(formatDelta(0.1 + 0.2)).toEqual({ text: "+0.3", dir: "up", label: "Up 0.3 since previous check" });
  });
});

describe("drPointLabel", () => {
  const points = [
    { x: Date.UTC(2026, 5, 30, 9), y: 44 },
    { x: Date.UTC(2026, 6, 1, 9), y: 43 },
    { x: Date.UTC(2026, 6, 20, 9), y: 43 },
    { x: Date.UTC(2026, 7, 14, 9), y: 47 },
  ];

  it("shows DR, UTC date and the rise since the previous reading", () => {
    expect(drPointLabel(points, 3)).toBe("DR 47 · 2026-08-14 · +4");
  });

  it("shows a drop with a minus sign", () => {
    expect(drPointLabel(points, 1)).toBe("DR 43 · 2026-07-01 · −1");
  });

  it("omits the change for the first reading", () => {
    expect(drPointLabel(points, 0)).toBe("DR 44 · 2026-06-30");
  });

  it("omits a zero change", () => {
    expect(drPointLabel(points, 2)).toBe("DR 43 · 2026-07-20");
  });

  const decimals = [
    { x: Date.UTC(2026, 10, 5, 9), y: 2.5 },
    { x: Date.UTC(2026, 10, 7, 9), y: 2.3 },
    { x: Date.UTC(2026, 10, 8, 9), y: 2.5 },
    { x: Date.UTC(2026, 10, 9, 9), y: 2.52 },
    { x: Date.UTC(2026, 10, 10, 9), y: 0.2 },
  ];

  it("shows a decimal DR and a decimal drop without float noise", () => {
    expect(drPointLabel(decimals, 1)).toBe("DR 2.3 · 2026-11-07 · −0.2");
  });

  it("shows a decimal rise", () => {
    expect(drPointLabel(decimals, 2)).toBe("DR 2.5 · 2026-11-08 · +0.2");
  });

  it("omits a change that rounds to zero at one decimal", () => {
    expect(drPointLabel(decimals, 3)).toBe("DR 2.5 · 2026-11-09");
  });

  it("keeps a DR below 1 instead of rounding it to 0", () => {
    expect(drPointLabel(decimals, 0)).toBe("DR 2.5 · 2026-11-05");
    expect(drPointLabel(decimals, 4)).toBe("DR 0.2 · 2026-11-10 · −2.3");
  });
});
