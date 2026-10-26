import { describe, it, expect } from "vitest";
import { parseDomainsQuery, DomainsQueryError } from "../server/utils/domainsQuery";

describe("parseDomainsQuery", () => {
  it("returns defaults", () => {
    expect(parseDomainsQuery({})).toEqual({
      page: 1, pageSize: 20, sortBy: "checked_at", sortDir: "desc", domain: "", tld: "",
      drMin: null, drMax: null, checkedFrom: null, checkedTo: null,
    });
  });
  it("accepts pageSize 50", () => expect(parseDomainsQuery({ pageSize: "50" }).pageSize).toBe(50));
  it("rejects bad pageSize", () => expect(() => parseDomainsQuery({ pageSize: "37" })).toThrow(DomainsQueryError));
  it("accepts dr_change sort", () => expect(parseDomainsQuery({ sortBy: "dr_change" }).sortBy).toBe("dr_change"));
  it("rejects unknown sortBy", () => expect(() => parseDomainsQuery({ sortBy: "foo" })).toThrow(DomainsQueryError));
  it("rejects unknown sortDir", () => expect(() => parseDomainsQuery({ sortDir: "x" })).toThrow(DomainsQueryError));
  it("normalizes tld", () => expect(parseDomainsQuery({ tld: ".CO.uk" }).tld).toBe("co.uk"));
  it("nulls invalid dates", () => expect(parseDomainsQuery({ checkedFrom: "2026-13-40" }).checkedFrom).toBeNull());
  it("clamps page", () => expect(parseDomainsQuery({ page: "-3" }).page).toBe(1));
});
