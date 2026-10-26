import { describe, it, expect } from "vitest";
import { navSection } from "../utils/navSection";

describe("navSection", () => {
  it("maps the check flow", () => {
    expect(navSection("/")).toBe("check");
    expect(navSection("/results/abc")).toBe("check");
  });
  it("maps domains and domain pages", () => {
    expect(navSection("/domains")).toBe("domains");
    expect(navSection("/domain/a.com")).toBe("domains");
  });
  it("maps docs", () => {
    expect(navSection("/docs")).toBe("docs");
  });
  it("returns null for unknown paths", () => {
    expect(navSection("/elsewhere")).toBeNull();
    expect(navSection("/domainsx")).toBeNull();
  });
});
