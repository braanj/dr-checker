import { describe, it, expect } from "vitest";
import { groupTrends } from "../server/utils/domainTrends";

describe("groupTrends", () => {
  it("orders oldest to newest and fills empty", () => {
    const rows = [
      { domain: "a", dr: 42, checked_at: "t3" },
      { domain: "a", dr: 45, checked_at: "t2" },
      { domain: "a", dr: 40, checked_at: "t1" },
      { domain: "b", dr: 10, checked_at: "t1" },
    ];
    expect(groupTrends(["a", "b", "c"], rows)).toEqual({ a: [40, 45, 42], b: [10], c: [] });
  });
  it("coerces numeric strings", () => {
    const rows = [{ domain: "a", dr: "42" as unknown as number, checked_at: "t" }];
    expect(groupTrends(["a"], rows)).toEqual({ a: [42] });
  });
});
