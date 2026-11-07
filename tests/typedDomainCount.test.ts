import { describe, expect, it } from "vitest";
import { typedDomainCount } from "../utils/typedDomainCount";

describe("typedDomainCount", () => {
  it("is 0 for empty or blank input", () => {
    expect(typedDomainCount("")).toBe(0);
    expect(typedDomainCount("  \n , ")).toBe(0);
  });

  it("counts comma- and newline-separated domains", () => {
    expect(typedDomainCount("a.com, b.org\nc.net")).toBe(3);
  });

  it("counts only entries the server would accept, like its cap does", () => {
    expect(typedDomainCount("a.com\nlocalhost\nnot a domain\nhttps://www.b.org/x")).toBe(2);
  });

  it("keeps duplicates, since each line gets its own result row", () => {
    expect(typedDomainCount("a.com\na.com")).toBe(2);
  });
});
