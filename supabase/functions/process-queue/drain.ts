// The worker's drain loop (ADR 0002). One loop at a time holds the
// worker_lease row; it claims small batches until the queue is empty, the
// time budget is spent, or the lease is lost, keeping a minimum gap between
// Ahrefs calls across the whole run. All I/O is injected so Vitest can drive
// it with a fake clock.

// Limits are tied together (tests/workerLimits.test.ts): one iteration's worst
// case (every row an Ahrefs call that times out) must fit inside the lease TTL,
// and budget + one worst iteration inside the edge wall-clock limit.
export const EDGE_WALL_CLOCK_MS = 150_000;
export const CLAIM_SIZE = 5; // urls claimed per iteration
export const AHREFS_TIMEOUT_MS = 8_000; // a hung call must not outlive the lease
export const AHREFS_DELAY_MS = 300;
export const LEASE_TTL_SECONDS = 60;
export const TIME_BUDGET_MS = 90_000; // checked before each claim; cron resumes

export type ClaimedRow = { id: string; domain: string; attempts: number };

export interface DrainDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Acquire or renew the lease; false means another worker holds it. */
  acquireLease(): Promise<boolean>;
  releaseLease(): Promise<void>;
  claim(): Promise<ClaimedRow[]>;
  /** Must call `pace()` immediately before each Ahrefs request. */
  processBatch(rows: ClaimedRow[], pace: () => Promise<void>): Promise<void>;
}

export type DrainResult =
  | { skipped: "busy" }
  | { processed: number; iterations: number; stoppedBy: "empty" | "budget" | "lease_lost" };

export function makePacer(deps: Pick<DrainDeps, "now" | "sleep">, gapMs = AHREFS_DELAY_MS) {
  let last: number | null = null;
  return async () => {
    if (last !== null) {
      const wait = last + gapMs - deps.now();
      if (wait > 0) await deps.sleep(wait);
    }
    last = deps.now();
  };
}

export async function drain(deps: DrainDeps): Promise<DrainResult> {
  if (!(await deps.acquireLease())) return { skipped: "busy" };

  const start = deps.now();
  const pace = makePacer(deps);
  let processed = 0;
  let iterations = 0;
  let stoppedBy: "empty" | "budget" | "lease_lost";

  try {
    while (true) {
      if (deps.now() - start > TIME_BUDGET_MS) {
        stoppedBy = "budget";
        break;
      }
      if (iterations > 0 && !(await deps.acquireLease())) {
        stoppedBy = "lease_lost";
        break;
      }
      const rows = await deps.claim();
      if (rows.length === 0) {
        stoppedBy = "empty";
        break;
      }
      await deps.processBatch(rows, pace);
      processed += rows.length;
      iterations++;
    }
  } finally {
    await deps.releaseLease();
  }

  return { processed, iterations, stoppedBy };
}
