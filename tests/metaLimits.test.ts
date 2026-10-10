import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { META_LIMITS } from "../supabase/functions/fetch-meta/safeFetch";
import { EDGE_WALL_CLOCK_MS } from "../supabase/functions/process-queue/drain";

describe("fetch-meta time limits", () => {
  it("lets the last domain finish before the edge wall clock kills the run", () => {
    expect(META_LIMITS.runBudgetMs + META_LIMITS.perDomainMs).toBeLessThan(EDGE_WALL_CLOCK_MS);
  });

  it("keeps the per-domain deadline above a single request timeout", () => {
    expect(META_LIMITS.perDomainMs).toBeGreaterThan(META_LIMITS.requestTimeoutMs);
  });

  it("keeps pg_net waiting longer than a whole run", () => {
    const sql = readFileSync("supabase/migrations/20261015000000_domain_meta.sql", "utf8");
    const timeout = Number(sql.match(/timeout_milliseconds := (\d+)/)?.[1]);
    expect(timeout).toBeGreaterThanOrEqual(META_LIMITS.runBudgetMs + META_LIMITS.perDomainMs);
  });
});
