import { describe, it, expect } from "vitest";
import {
  drain,
  makePacer,
  TIME_BUDGET_MS,
  type ClaimedRow,
  type DrainDeps,
} from "../supabase/functions/process-queue/drain";

const row = (i: number): ClaimedRow => ({ id: `r${i}`, domain: `d${i}.com`, attempts: 1 });

// A fake world: a virtual clock, a queue of claim results, and a call log.
function fakeDeps(opts: {
  claims: ClaimedRow[][];
  leases?: boolean[]; // successive acquireLease results (default: always true)
  batchMs?: number; // virtual time each processBatch takes
  onBatch?: (rows: ClaimedRow[], pace: () => Promise<void>) => Promise<void>;
}) {
  let t = 0;
  const log: string[] = [];
  const sleeps: number[] = [];
  const leases = [...(opts.leases ?? [])];
  const claims = [...opts.claims];
  const deps: DrainDeps = {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    acquireLease: async () => {
      log.push("lease");
      return leases.length ? leases.shift()! : true;
    },
    releaseLease: async () => {
      log.push("release");
    },
    claim: async () => {
      log.push("claim");
      return claims.shift() ?? [];
    },
    processBatch: async (rows, pace) => {
      log.push(`batch:${rows.length}`);
      if (opts.onBatch) await opts.onBatch(rows, pace);
      t += opts.batchMs ?? 0;
    },
  };
  return { deps, log, sleeps, advance: (ms: number) => (t += ms) };
}

describe("drain", () => {
  it("returns busy without claiming when the lease is held elsewhere", async () => {
    const { deps, log } = fakeDeps({ claims: [[row(1)]], leases: [false] });
    expect(await drain(deps)).toEqual({ skipped: "busy" });
    expect(log).toEqual(["lease"]);
  });

  it("drains until the queue is empty, then releases the lease", async () => {
    const { deps, log } = fakeDeps({ claims: [[row(1), row(2)], [row(3)]] });
    expect(await drain(deps)).toEqual({ processed: 3, iterations: 2, stoppedBy: "empty" });
    expect(log).toEqual(["lease", "claim", "batch:2", "lease", "claim", "batch:1", "lease", "claim", "release"]);
  });

  it("stops before claiming again once the time budget is spent, finishing the current batch", async () => {
    const { deps, log } = fakeDeps({ claims: [[row(1)], [row(2)]], batchMs: TIME_BUDGET_MS + 1 });
    expect(await drain(deps)).toEqual({ processed: 1, iterations: 1, stoppedBy: "budget" });
    expect(log).toEqual(["lease", "claim", "batch:1", "release"]);
  });

  it("stops without claiming when the lease renewal fails", async () => {
    const { deps, log } = fakeDeps({ claims: [[row(1)], [row(2)]], leases: [true, false] });
    expect(await drain(deps)).toEqual({ processed: 1, iterations: 1, stoppedBy: "lease_lost" });
    expect(log).toEqual(["lease", "claim", "batch:1", "lease", "release"]);
  });

  it("releases the lease even when a batch throws", async () => {
    const { deps, log } = fakeDeps({
      claims: [[row(1)]],
      onBatch: async () => {
        throw new Error("boom");
      },
    });
    await expect(drain(deps)).rejects.toThrow("boom");
    expect(log.at(-1)).toBe("release");
  });

  it("keeps Ahrefs spacing across iterations instead of resetting per claim", async () => {
    const { deps, sleeps } = fakeDeps({
      claims: [[row(1)], [row(2)]],
      onBatch: async (_rows, pace) => {
        await pace(); // one Ahrefs call per batch, instantly
      },
    });
    await drain(deps);
    expect(sleeps).toEqual([300]); // the second call waited for the first's gap
  });
});

describe("makePacer", () => {
  it("does not wait on the first call and waits only the remaining gap later", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const pace = makePacer({ now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } });
    await pace();
    t += 100;
    await pace();
    t += 500;
    await pace();
    expect(sleeps).toEqual([200]);
  });
});
