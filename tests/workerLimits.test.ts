import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  AHREFS_DELAY_MS,
  AHREFS_TIMEOUT_MS,
  CLAIM_SIZE,
  EDGE_WALL_CLOCK_MS,
  LEASE_TTL_SECONDS,
  TIME_BUDGET_MS,
} from "../supabase/functions/process-queue/drain";

// Worst case for one iteration: every claimed row needs its own Ahrefs call
// and every call hangs until the timeout.
const worstIterationMs = CLAIM_SIZE * (AHREFS_TIMEOUT_MS + AHREFS_DELAY_MS);

describe("worker time limits", () => {
  it("renews the lease more often than it can expire, so two loops never overlap", () => {
    expect(worstIterationMs).toBeLessThan(LEASE_TTL_SECONDS * 1000);
  });

  it("finishes the last iteration before the edge wall-clock limit kills the run", () => {
    expect(TIME_BUDGET_MS + worstIterationMs).toBeLessThan(EDGE_WALL_CLOCK_MS);
  });

  it("keeps pg_net waiting at least as long as a run can last, so the call is never dropped", () => {
    const sql = readFileSync("supabase/migrations/20261011000000_worker_kick_vault.sql", "utf8");
    const timeout = Number(sql.match(/timeout_milliseconds := (\d+)/)?.[1]);
    expect(timeout).toBeGreaterThanOrEqual(EDGE_WALL_CLOCK_MS);
  });
});
