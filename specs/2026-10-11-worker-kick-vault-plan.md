# Worker Trigger, Drain Loop and Shared Secret Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-row dashboard webhook and the plaintext-key cron with repo-managed, Vault-backed triggers that start one secret-protected, paced drain loop.

**Architecture:**
- A statement-level trigger and the 10 s cron both call `public.kick_worker()`. It checks whether any rows are due, reads `worker_secret`/`worker_url` from Vault, and sends one async `pg_net` request with an `x-worker-secret` header.
- The `process-queue` edge function rejects calls without the secret.
- A worker holds a single-row lease while it drains the queue. It claims 5 rows at a time, with ≥300 ms between Ahrefs calls, until the queue is empty, the 120 s time budget runs out, or it loses the lease.

**Tech Stack:** Supabase Postgres (pg_net, pg_cron, supabase_vault), Supabase Edge Functions (Deno), Vitest, bash.

**Spec:** `specs/adr/0002-worker-trigger-and-secret.md`. Read it first; this plan argues from it.

**Branch:** `feat/worker-kick-vault` (already created; it contains the ADR commit `a3b37b3`).

## Global Constraints

- **One drain loop at a time**, enforced by the `worker_lease` row (TTL **60 s**, renewed on every iteration).
- **≥ 300 ms between Ahrefs calls across the whole run**, not reset per iteration.
- **Time budget 120 s** per run (the edge function's wall-clock limit is 150 s). Claim size stays **5**.
- **Header name:** `x-worker-secret`. **Function secret:** `WORKER_SECRET`. **Vault names:** `worker_secret` and `worker_url`.
- **Worker auth responses:**
  - wrong or missing header: **401** `{"error":"unauthorized"}`, with nothing touched;
  - `WORKER_SECRET` unset: **500** `{"error":"worker not configured"}`.
- **Run results:**
  - lease busy: **200** `{"skipped":"busy"}`;
  - otherwise **200** `{"processed":N,"iterations":K,"stoppedBy":...}`.
- **Missing Vault entries** make `kick_worker()` raise a **warning** and return. It must never raise an error, so inserts and `/api/check` never fail because of it.
- **`kick_worker`, `acquire_worker_lease` and `release_worker_lease`** have execute revoked from `public, anon, authenticated`. `worker_lease` has RLS on and no policies.
- **No secret value** ever appears in the repo, in `cron.job`, or in command output.
- Unchanged: `outcome.ts`, `_shared/cache.ts`, `claim_pending_urls`, retries, backoff and stuck-row reclaim.
- **Release order:** provision secrets (user) → `db push` (Claude) → deploy function (Claude) → verify → PR → merge. It follows ADR 0002's rollout and the working rules from the step-1 plan.

## Review Focus

1. **The worker crashes or throws mid-batch.** The lease must still be released (or expire), so the next cron tick can drain. Pinned in Task 2 (`drain` releases the lease when `processBatch` throws).
2. **Odd header values:** an empty `WORKER_SECRET`, a header of a different length, a header with surrounding whitespace, or a case-variant. All must be rejected; only an exact match passes. Pinned in Task 1.
3. **Fast iterations.** If the cache answers whole claims instantly, the spacing between Ahrefs calls must still hold across iterations rather than reset per claim. Pinned in Task 2 (pacer test across two `processBatch` calls).
4. **The time budget runs out mid-iteration.** The current batch finishes, but no new claim starts after the budget, so no row is claimed and then abandoned. Pinned in Task 2.
5. **Lease renewal fails** (another holder took it after we expired, or the RPC errored). The loop must stop **before** claiming more rows. Pinned in Task 2, and Task 3 maps RPC errors to `false`.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/functions/process-queue/auth.ts` (new) | `checkWorkerSecret`: pure, constant-time header check |
| `supabase/functions/process-queue/drain.ts` (new) | `drain` loop and `makePacer`: pure, dependencies injected |
| `supabase/functions/process-queue/index.ts` | Deno wiring: auth, then lease RPCs, claim, and the existing per-batch processing as `processBatch` |
| `supabase/migrations/20261011000000_worker_kick_vault.sql` (new) | Lease table and RPCs, `kick_worker`, statement trigger, drop the webhook, reschedule the cron |
| `supabase/schema.sql` | Same end state for fresh installs; the placeholder backstop is removed |
| `scripts/provision-worker-secret.sh` (new) | Provision or rotate `WORKER_SECRET` and the Vault entries without printing them |
| `tests/workerAuth.test.ts`, `tests/drain.test.ts` (new) | Unit tests |
| `CLAUDE.md`, `README.md` | Setup and architecture docs |

---

### Task 1: Worker secret check (`auth.ts`)

**Files:**
- Create: `supabase/functions/process-queue/auth.ts`
- Test: `tests/workerAuth.test.ts`

**Interfaces:**
- Produces: `type AuthResult = { ok: true } | { ok: false; status: 401 | 500; error: string }` and `checkWorkerSecret(header: string | null, expected: string | undefined): AuthResult`.

- [ ] **Step 1: Write the failing test**

Create `tests/workerAuth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkWorkerSecret } from "../supabase/functions/process-queue/auth";

const SECRET = "a".repeat(64);

describe("checkWorkerSecret", () => {
  it("accepts an exact match", () => {
    expect(checkWorkerSecret(SECRET, SECRET)).toEqual({ ok: true });
  });

  it("rejects a missing or wrong header with 401", () => {
    const unauthorized = { ok: false, status: 401, error: "unauthorized" };
    expect(checkWorkerSecret(null, SECRET)).toEqual(unauthorized);
    expect(checkWorkerSecret("", SECRET)).toEqual(unauthorized);
    expect(checkWorkerSecret("b".repeat(64), SECRET)).toEqual(unauthorized);
  });

  it("rejects near-misses: other length, whitespace, case", () => {
    expect(checkWorkerSecret(SECRET.slice(1), SECRET)).toMatchObject({ status: 401 });
    expect(checkWorkerSecret(SECRET + "a", SECRET)).toMatchObject({ status: 401 });
    expect(checkWorkerSecret(` ${SECRET} `, SECRET)).toMatchObject({ status: 401 });
    expect(checkWorkerSecret(SECRET.toUpperCase(), SECRET)).toMatchObject({ status: 401 });
  });

  it("returns 500 when the worker secret is not configured, whatever the header", () => {
    const notConfigured = { ok: false, status: 500, error: "worker not configured" };
    expect(checkWorkerSecret(SECRET, undefined)).toEqual(notConfigured);
    expect(checkWorkerSecret("", "")).toEqual(notConfigured);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL, because `supabase/functions/process-queue/auth` cannot be resolved.

- [ ] **Step 3: Implement `supabase/functions/process-queue/auth.ts`**

```ts
// Shared-secret check for the process-queue worker (ADR 0002). Postgres
// (kick_worker via pg_net) sends `x-worker-secret`; the function compares it
// with its WORKER_SECRET in constant time. Pure, so Vitest can test it.

export type AuthResult = { ok: true } | { ok: false; status: 401 | 500; error: string };

function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function checkWorkerSecret(header: string | null, expected: string | undefined): AuthResult {
  if (!expected) return { ok: false, status: 500, error: "worker not configured" };
  if (!header || !constantTimeEqual(header, expected)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS (all previous tests plus 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/process-queue/auth.ts tests/workerAuth.test.ts
git commit -m "feat(worker): constant-time shared-secret check"
```

---

### Task 2: Drain loop with lease and global pacing (`drain.ts`)

**Files:**
- Create: `supabase/functions/process-queue/drain.ts`
- Test: `tests/drain.test.ts`

**Interfaces:**
- Produces:
  - constants `LEASE_TTL_SECONDS = 60`, `TIME_BUDGET_MS = 120_000`, `AHREFS_DELAY_MS = 300`;
  - `type ClaimedRow = { id: string; domain: string; attempts: number }`;
  - `interface DrainDeps { now(): number; sleep(ms: number): Promise<void>; acquireLease(): Promise<boolean>; releaseLease(): Promise<void>; claim(): Promise<ClaimedRow[]>; processBatch(rows: ClaimedRow[], pace: () => Promise<void>): Promise<void> }`;
  - `type DrainResult = { skipped: "busy" } | { processed: number; iterations: number; stoppedBy: "empty" | "budget" | "lease_lost" }`;
  - `makePacer(deps: Pick<DrainDeps, "now" | "sleep">, gapMs?: number): () => Promise<void>`;
  - `drain(deps: DrainDeps): Promise<DrainResult>`.
- `acquireLease` both acquires and renews; it is called once before the loop and again at the start of every later iteration. `processBatch` must call `pace()` **immediately before each Ahrefs request**.

- [ ] **Step 1: Write the failing tests**

Create `tests/drain.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL, because `supabase/functions/process-queue/drain` cannot be resolved.

- [ ] **Step 3: Implement `supabase/functions/process-queue/drain.ts`**

```ts
// The worker's drain loop (ADR 0002). One loop at a time holds the
// worker_lease row; it claims small batches until the queue is empty, the
// time budget is spent, or the lease is lost, keeping a minimum gap between
// Ahrefs calls across the whole run. All I/O is injected so Vitest can drive
// it with a fake clock.

export const LEASE_TTL_SECONDS = 60;
export const TIME_BUDGET_MS = 120_000; // edge wall-clock limit is 150 s; cron resumes
export const AHREFS_DELAY_MS = 300;

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
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS (7 new tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/process-queue/drain.ts tests/drain.test.ts
git commit -m "feat(worker): leased drain loop with run-wide Ahrefs pacing"
```

---

### Task 3: Wire the edge function (`index.ts`)

**Files:**
- Modify: `supabase/functions/process-queue/index.ts` (full rewrite below; per-batch logic unchanged)

**Interfaces:**
- Consumes:
  - `checkWorkerSecret` (Task 1);
  - `drain`, `LEASE_TTL_SECONDS`, `ClaimedRow`, `DrainDeps` (Task 2);
  - RPCs `acquire_worker_lease(p_holder uuid, p_ttl_seconds integer) returns boolean` and `release_worker_lease(p_holder uuid)` (Task 4);
  - the existing `claim_pending_urls(p_limit)`.
- Produces: the HTTP contract listed in Global Constraints.

- [ ] **Step 1: Rewrite `supabase/functions/process-queue/index.ts`**

```ts
// Invoked (ADR 0002) by public.kick_worker() via pg_net, from:
//   1. trg_urls_kick_worker — once per INSERT statement that adds pending rows
//   2. pg_cron every 10 s — only when rows are due
// Every call must carry `x-worker-secret` (see ./auth.ts). One call at a time
// holds the worker_lease row and drains the queue (./drain.ts): claim 5 due
// rows (FOR UPDATE SKIP LOCKED; stuck rows reclaimed after 2 minutes), answer
// from the `domains` cache when fresh, otherwise call Ahrefs once per domain
// with ≥300 ms between calls across the whole run. Decisions live in
// ./outcome.ts; table triggers roll batch progress up and broadcast changes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cachedUrlFields, isFresh, type DomainCacheRow } from "../_shared/cache.ts";
import { checkWorkerSecret } from "./auth.ts";
import { drain, LEASE_TTL_SECONDS, type ClaimedRow, type DrainDeps } from "./drain.ts";
import {
  cacheWriteFor,
  classifyAhrefsResponse,
  GAVE_UP_MESSAGE,
  isExhausted,
  urlUpdateFor,
  type AhrefsResult,
} from "./outcome.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AHREFS_DR_RATING_KEY = Deno.env.get("AHREFS_DR_RATING")!;
const WORKER_SECRET = Deno.env.get("WORKER_SECRET");

const CLAIM_SIZE = 5; // urls claimed per iteration
const AHREFS_TIMEOUT_MS = 20_000; // a hung call must not outlive the run

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function fetchDomainRating(domain: string): Promise<AhrefsResult> {
  const url = `https://api.ahrefs.com/v3/public/domain-rating-free?target=${encodeURIComponent(
    domain,
  )}&output=json`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${AHREFS_DR_RATING_KEY}`,
      },
      signal: AbortSignal.timeout(AHREFS_TIMEOUT_MS),
    });
    const body = res.ok ? await res.json().catch(() => null) : null;
    return classifyAhrefsResponse(res.status, body);
  } catch (err) {
    return { kind: "transient", error: String(err) };
  }
}

async function updateUrl(id: string, fields: object) {
  const { error } = await supabase.from("urls").update(fields).eq("id", id);
  if (error) console.error("url update failed", id, error.message);
}

// One claimed batch: group by domain, answer fresh cache hits, finalize
// exhausted rows, otherwise one paced Ahrefs call per domain.
async function processBatch(rows: ClaimedRow[], pace: () => Promise<void>) {
  const byDomain = new Map<string, ClaimedRow[]>();
  for (const row of rows) byDomain.set(row.domain, [...(byDomain.get(row.domain) ?? []), row]);

  const { data: cacheRows, error: cacheError } = await supabase
    .from("domains")
    .select("domain, dr, status, checked_at")
    .in("domain", [...byDomain.keys()]);
  if (cacheError) console.error("cache read failed, calling Ahrefs for all", cacheError.message);
  const cache = new Map(((cacheRows ?? []) as DomainCacheRow[]).map((c) => [c.domain, c]));

  const writes: PromiseLike<unknown>[] = [];

  for (const [domain, domainRows] of byDomain) {
    const previous = cache.get(domain) ?? null;

    if (previous && isFresh(previous, new Date())) {
      for (const row of domainRows) writes.push(updateUrl(row.id, cachedUrlFields(previous)));
      continue;
    }

    const exhausted = domainRows.filter((row) => isExhausted(row.attempts));
    for (const row of exhausted) {
      const gaveUp: AhrefsResult = { kind: "transient", error: GAVE_UP_MESSAGE };
      writes.push(updateUrl(row.id, urlUpdateFor(gaveUp, row.attempts, previous, new Date())));
    }
    const live = domainRows.filter((row) => !isExhausted(row.attempts));
    if (live.length === 0) continue;

    await pace();
    const result = await fetchDomainRating(domain);
    const checkedAt = new Date();

    const cacheWrite = cacheWriteFor(result);
    if (cacheWrite) {
      writes.push(
        supabase
          .from("domains")
          .upsert({ domain, ...cacheWrite, checked_at: checkedAt.toISOString() })
          .then(({ error }) => {
            if (error) console.error("domains upsert failed", domain, error.message);
          }),
      );
    }

    for (const row of live) {
      writes.push(updateUrl(row.id, urlUpdateFor(result, row.attempts, previous, checkedAt)));
    }
  }

  await Promise.all(writes);
}

Deno.serve(async (req) => {
  const auth = checkWorkerSecret(req.headers.get("x-worker-secret"), WORKER_SECRET);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const holder = crypto.randomUUID();
  const deps: DrainDeps = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    acquireLease: async () => {
      const { data, error } = await supabase.rpc("acquire_worker_lease", {
        p_holder: holder,
        p_ttl_seconds: LEASE_TTL_SECONDS,
      });
      if (error) console.error("lease acquire failed", error.message);
      return !error && data === true;
    },
    releaseLease: async () => {
      const { error } = await supabase.rpc("release_worker_lease", { p_holder: holder });
      if (error) console.error("lease release failed (expires in 60 s)", error.message);
    },
    claim: async () => {
      const { data, error } = await supabase.rpc("claim_pending_urls", { p_limit: CLAIM_SIZE });
      if (error) throw new Error(`claim failed: ${error.message}`);
      return (data ?? []) as ClaimedRow[];
    },
    processBatch,
  };

  try {
    return json(await drain(deps));
  } catch (err) {
    console.error("drain failed", err);
    return json({ error: String(err) }, 500);
  }
});
```

- [ ] **Step 2: Type-check and run the tests**

Run: `deno check supabase/functions/process-queue/index.ts && npm test`
Expected: `deno check` reports no errors (delete the `deno.lock` it may create; it isn't tracked), and every test passes.

- [ ] **Step 3: Commit**

```bash
rm -f deno.lock
git add supabase/functions/process-queue/index.ts
git commit -m "feat(worker): require x-worker-secret and drain under a lease"
```

---

### Task 4: Migration and schema (`kick_worker`, lease, trigger, cron)

**Files:**
- Create: `supabase/migrations/20261011000000_worker_kick_vault.sql`
- Modify: `supabase/schema.sql` (append the same objects; replace the placeholder "pg_cron backstop" block at the end)

**Interfaces:**
- Produces:
  - table `public.worker_lease(id smallint pk = 1, holder uuid, expires_at timestamptz)`;
  - `acquire_worker_lease(p_holder uuid, p_ttl_seconds integer default 60) returns boolean`;
  - `release_worker_lease(p_holder uuid) returns void`;
  - `kick_worker() returns void`;
  - trigger `trg_urls_kick_worker`;
  - cron job `process-queue-backstop` running `select public.kick_worker()`.

No SQL test harness exists locally (no Docker or Supabase CLI database). Verification is a Postgres parse check (Step 3) plus the read-only production checks in Rollout.

- [ ] **Step 1: Write `supabase/migrations/20261011000000_worker_kick_vault.sql`**

```sql
-- ============================================================================
-- ADR 0002: one paced drain loop, started by a statement-level trigger and a
-- due-rows-only cron, authenticated with a shared secret held in Vault.
-- Requires Vault entries `worker_secret` and `worker_url`
-- (scripts/provision-worker-secret.sh). Without them kick_worker() only warns.
-- ============================================================================

-- 1. single-row lease: at most one drain loop at a time -----------------------
create table if not exists public.worker_lease (
  id         smallint primary key default 1 check (id = 1),
  holder     uuid,
  expires_at timestamptz not null default '-infinity'
);
insert into public.worker_lease (id) values (1) on conflict (id) do nothing;
alter table public.worker_lease enable row level security;

-- Acquire, or renew if already held by p_holder. Concurrent callers serialize
-- on the row lock; the loser re-checks the WHERE against the winner's row and
-- gets false.
create or replace function public.acquire_worker_lease(p_holder uuid, p_ttl_seconds integer default 60)
returns boolean
language plpgsql
as $$
begin
  update public.worker_lease
  set holder = p_holder,
      expires_at = now() + make_interval(secs => p_ttl_seconds)
  where id = 1
    and (holder is null or holder = p_holder or expires_at < now());
  return found;
end;
$$;

create or replace function public.release_worker_lease(p_holder uuid)
returns void
language plpgsql
as $$
begin
  update public.worker_lease
  set holder = null, expires_at = '-infinity'
  where id = 1 and holder = p_holder;
end;
$$;

-- 2. the only caller of the edge function --------------------------------------
create or replace function public.kick_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_url    text;
begin
  -- cheap guard (idx_urls_claimable): never wake the worker for nothing
  if not exists (
    select 1 from public.urls u
    where (u.status = 'pending' and u.available_at <= now())
       or (u.status = 'processing' and u.claimed_at < now() - interval '2 minutes')
  ) then
    return;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'worker_secret';
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'worker_url';

  if v_secret is null or v_url is null then
    raise warning 'kick_worker: vault entries worker_secret/worker_url missing; worker not started';
    return;
  end if;

  -- async: queued now, sent by pg_net after commit
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;

-- 3. statement-level trigger replaces the per-row dashboard webhook ---------
create or replace function public.urls_kick_worker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from inserted where status = 'pending') then
    perform public.kick_worker();
  end if;
  return null;
end;
$$;

drop trigger if exists "process-queue" on public.urls;  -- dashboard webhook (ADR 0001)
drop trigger if exists trg_urls_kick_worker on public.urls;
create trigger trg_urls_kick_worker
  after insert on public.urls
  referencing new table as inserted
  for each statement execute function public.urls_kick_worker();

-- 4. server-only ---------------------------------------------------------------
revoke execute on function public.acquire_worker_lease(uuid, integer) from public, anon, authenticated;
revoke execute on function public.release_worker_lease(uuid) from public, anon, authenticated;
revoke execute on function public.kick_worker() from public, anon, authenticated;
revoke execute on function public.urls_kick_worker() from public, anon, authenticated;

-- 5. backstop: no key in cron.job, and no HTTP call unless rows are due --------
select cron.unschedule(jobid) from cron.job where jobname = 'process-queue-backstop';
select cron.schedule('process-queue-backstop', '10 seconds', $$select public.kick_worker()$$);
```

- [ ] **Step 2: Update `supabase/schema.sql`**

- Insert sections 1–4 of the migration (the lease table, the two lease RPCs, `kick_worker`, `urls_kick_worker` with its trigger, and the revokes) right **before** the `-- pg_cron: hourly cleanup of the rate-limit log` section. Omit the `drop trigger if exists "process-queue"` line, because fresh installs never have the dashboard webhook.
- Replace the whole final block, from `-- pg_cron backstop: calls the process-queue edge function every 10s so` to the end of the file, with:

```sql
-- ----------------------------------------------------------------------------
-- pg_cron backstop (ADR 0002): every 10 s, kick_worker() starts the worker
-- only if rows are due (retries after backoff, stuck-row reclaim). It reads
-- the function URL and shared secret from Vault — run
-- scripts/provision-worker-secret.sh once per project; nothing to edit here.
-- ----------------------------------------------------------------------------

select cron.unschedule(jobid) from cron.job where jobname = 'process-queue-backstop';
select cron.schedule('process-queue-backstop', '10 seconds', $$select public.kick_worker()$$);
```

- Update the header comment line `-- Existing projects: run supabase/migrations/20261007000000_domain_directory.sql` to `-- Existing projects: apply supabase/migrations/ with \`supabase db push\``.

- [ ] **Step 3: Parse-check both files**

Run (the session scratchpad parser; if it's missing, recreate `/private/tmp/claude-501/-Users-brahim-Work-projects-dr-checker/e522dd7c-e050-4227-8a3a-338bb3ca45f5/scratchpad/pgparse` with `npm i libpg-query@17` plus the 6-line `check.mjs` that calls `parse()` on each argument):
`node /private/tmp/claude-501/-Users-brahim-Work-projects-dr-checker/e522dd7c-e050-4227-8a3a-338bb3ca45f5/scratchpad/pgparse/check.mjs supabase/schema.sql supabase/migrations/20261011000000_worker_kick_vault.sql`
Expected: `OK` for both files.

Then confirm no secret placeholder remains:
`grep -n "PROJECT_REF\|SERVICE_ROLE_KEY>" supabase/schema.sql`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261011000000_worker_kick_vault.sql supabase/schema.sql
git commit -m "feat(db): vault-backed kick_worker, statement trigger, lease, keyless backstop"
```

---

### Task 5: Provisioning script and docs

**Files:**
- Create: `scripts/provision-worker-secret.sh`
- Modify: `CLAUDE.md` (setup list, architecture diagram and paragraph), `README.md` (diagram, "Why a Postgres queue" bullets, Setup steps 5–6)

**Interfaces:**
- Consumes: Vault names `worker_secret`/`worker_url`, function secret `WORKER_SECRET` (Tasks 3–4).
- Produces: `scripts/provision-worker-secret.sh <project-ref>`. It needs `SUPABASE_ACCESS_TOKEN` in the environment, never prints the secret, and creates or rotates both Vault entries plus the function secret.

- [ ] **Step 1: Write `scripts/provision-worker-secret.sh`**

```bash
#!/usr/bin/env bash
# Provision or rotate the process-queue worker secret (ADR 0002).
# Sets the edge-function secret WORKER_SECRET and the Vault entries
# worker_secret + worker_url to matching values. Never prints the secret.
#
# Usage: SUPABASE_ACCESS_TOKEN=... scripts/provision-worker-secret.sh <project-ref>
# Rotation: rerun it. Calls made between the two updates may get a 401;
# kick_worker()'s cron retries within 10 s.
set -euo pipefail

REF="${1:?usage: $0 <project-ref>}"
: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN}"

SECRET="$(openssl rand -hex 32)"
URL="https://${REF}.supabase.co/functions/v1/process-queue"

npx -y supabase@2.109.0 secrets set --project-ref "$REF" "WORKER_SECRET=${SECRET}" >/dev/null
echo "function secret WORKER_SECRET set"

# Values are hex and a URL (no quotes), so plain literals are safe.
SQL="do \$\$
begin
  if exists (select 1 from vault.secrets where name = 'worker_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'worker_secret'), '${SECRET}');
  else
    perform vault.create_secret('${SECRET}', 'worker_secret');
  end if;
  if exists (select 1 from vault.secrets where name = 'worker_url') then
    perform vault.update_secret((select id from vault.secrets where name = 'worker_url'), '${URL}');
  else
    perform vault.create_secret('${URL}', 'worker_url');
  end if;
end
\$\$;"

STATUS="$(python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$SQL" \
  | curl -s -o /dev/null -w '%{http_code}' -X POST \
      "https://api.supabase.com/v1/projects/${REF}/database/query" \
      -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
      -H "Content-Type: application/json" \
      --data-binary @-)"

if [[ "$STATUS" != 2* ]]; then
  echo "vault update failed (HTTP ${STATUS})" >&2
  exit 1
fi
echo "vault entries worker_secret + worker_url set"
```

Then:
```bash
chmod +x scripts/provision-worker-secret.sh
bash -n scripts/provision-worker-secret.sh
```
Expected: no output (the syntax is valid).

- [ ] **Step 2: Update CLAUDE.md**

In "Supabase-side setup/deploy", replace the webhook bullet and the placeholder-cron bullet with:
```
- run `scripts/provision-worker-secret.sh <project-ref>` once (and to rotate): it sets the function secret `WORKER_SECRET` and the Vault entries `worker_secret`/`worker_url` that `kick_worker()` uses (ADR 0002);
```
In the architecture diagram, replace the line `|  NOTIFY (webhook) + pg_cron backstop (10s)` with `|  kick_worker(): statement trigger + pg_cron (10s), x-worker-secret`, and the worker box line `- claims due urls ...` with `- one leased drain loop: claims 5 due urls at a time (SKIP LOCKED, reclaims stuck rows), ≥300 ms between Ahrefs calls, 120 s budget`.

In the "Why a Postgres queue" paragraph, replace "a Database Webhook on `urls` INSERT (fast start), and a pg_cron call every ~10s as a backstop" with:
```
the statement-level trigger `trg_urls_kick_worker` (once per INSERT that adds pending rows) and a pg_cron call every 10 s, both via `public.kick_worker()`, which only calls the function when rows are due and authenticates with a Vault-held shared secret. A single-row `worker_lease` keeps one drain loop at a time (ADR 0002)
```

- [ ] **Step 3: Update README.md**

- Diagram: change `NOTIFY (webhook) + pg_cron backstop` to `kick_worker(): trigger + pg_cron`.
- Replace bullets 1–2 under "A Supabase Edge Function (`process-queue`) does the actual work" with:
  - **Statement trigger:** `trg_urls_kick_worker` starts it once per INSERT that adds pending rows.
  - **pg_cron:** calls `kick_worker()` every 10 s, which only starts the worker when rows are due (retries, stuck rows).
  - **Shared secret:** both send a Vault-held secret, and a single-row lease keeps one paced drain loop at a time.
- Setup: replace steps 5–6 (dashboard webhook, cron placeholders) with: `5. Provision the worker secret: SUPABASE_ACCESS_TOKEN=... scripts/provision-worker-secret.sh <project-ref>`, then renumber the remaining steps.

- [ ] **Step 4: Check that no stale setup text remains, then run the tests**

Run: `grep -n "Database Webhook\|PROJECT_REF\|SERVICE_ROLE_KEY>" CLAUDE.md README.md supabase/schema.sql; npm test`
Expected: grep prints nothing, and every test passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/provision-worker-secret.sh CLAUDE.md README.md
git commit -m "docs: provision-worker-secret script and ADR 0002 setup"
```

---

## Rollout (after all tasks; the order matters)

The order is the one in ADR 0002, and it means processing never stops.

0. **Allow rules (Claude):** use the `update-config` skill to add, in `.claude/settings.local.json`, allow rules for this project's `npx supabase@2.109.0 db push`, `npx supabase@2.109.0 functions deploy process-queue` and `npx supabase@2.109.0 migration list` (step-1 plan, Q4/Q8).
1. **Provision (user, sensitive):**
   `! export PATH=$HOME/.nvm/versions/node/v24.16.0/bin:$PATH; SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env | cut -d= -f2- | tr -d '"'"'"' \r') scripts/provision-worker-secret.sh jwlpauxspwybjkxxujvc`
   Expected output: both "… set" lines. The running (old) function ignores the header, so nothing changes yet.
2. **Migrate (Claude):** run `db push`. Expect only `20261011000000` to be pending. The old function ignores `x-worker-secret`, so processing continues.
3. **Deploy (Claude):** `functions deploy process-queue --no-verify-jwt`. From this point the function enforces the secret.
4. **Verify (Claude; read-only except the live checks):**
   - `curl -X POST https://jwlpauxspwybjkxxujvc.supabase.co/functions/v1/process-queue` without the header → **401**.
   - SQL:
     - `cron.job` command = `select public.kick_worker()`, with no key, and the recent `job_run_details` succeeded;
     - `trg_urls_kick_worker` exists and `"process-queue"` doesn't;
     - Vault has both names (names only, never the values);
     - `worker_lease` holder is null while idle.
   - Idle: no new `net._http_response` rows over 30 s while nothing is due.
   - Live (writes, as in previous rollouts):
     - 2 uncached typed domains complete inline within ~5 s;
     - rechecking them is fully cached, and no new `net._http_response` row appears;
     - ~15 uncached domains are drained in one run (the function response shows `iterations` ≥ 3), the batch reaches `completed`, and the logged Ahrefs calls are ≥ 300 ms apart.
   - `migration list` shows local = remote.
5. **PR:** push the branch and open the prefilled PR. The user merges.

**Rollback:**
1. A follow-up migration recreates the row-level webhook trigger (`supabase_functions.http_request` to the function URL, as in ADR 0001) and reschedules the old cron command.
2. Redeploy the function from the previous `main`.
3. The Vault entries and the lease table can stay.
