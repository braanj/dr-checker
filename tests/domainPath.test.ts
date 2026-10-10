import { describe, it, expect } from "vitest";
import { domainPath, resolveDomainParam } from "../utils/domainPath";

describe("resolveDomainParam", () => {
  it("accepts an already canonical domain", () => {
    expect(resolveDomainParam("example.com")).toEqual({ domain: "example.com", canonical: true });
    expect(resolveDomainParam("blog.example.com")).toEqual({ domain: "blog.example.com", canonical: true });
  });

  it("flags spellings that must redirect to the canonical path", () => {
    expect(resolveDomainParam("WWW.Example.COM")).toEqual({ domain: "example.com", canonical: false });
    expect(resolveDomainParam("example.com%2Fpage")).toEqual({ domain: "example.com", canonical: false });
    expect(resolveDomainParam("https%3A%2F%2Fexample.com")).toEqual({ domain: "example.com", canonical: false });
  });

  it("rejects garbage", () => {
    expect(resolveDomainParam("localhost")).toBeNull();
    expect(resolveDomainParam("not a domain")).toBeNull();
    expect(resolveDomainParam("%E0%A4%A")).toBeNull();
    expect(resolveDomainParam("")).toBeNull();
  });
});

describe("domainPath", () => {
  it("builds the page path", () => {
    expect(domainPath("example.com")).toBe("/domain/example.com");
  });
});
