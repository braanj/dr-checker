# ADR 0002: Worker trigger, drain loop and shared secret

- **Status:** Accepted
- **Date:** 2026-10-11
- **Supersedes:** the "Processing" trigger details of ADR 0001 (webhook and cron)

## Context

ADR 0001 left the worker triggering outside the repo, and the 2026-10-10 audit found four problems with it:

1. **Per-row fan-out.** The `process-queue` Database Webhook was created in the dashboard as `AFTER INSERT ON urls FOR EACH ROW`. A 1,000-row CSV starts about 1,000 concurrent function runs. That bypasses the 300 ms spacing between Ahrefs calls, and it also fires for rows that were already answered from the cache.
2. **Not reproducible.** The webhook exists only in the dashboard, and the cron backstop in `schema.sql` contains `<PROJECT_REF>`/`<SERVICE_ROLE_KEY>` placeholders. The live cron job was created by hand.
3. **Plaintext key.** The cron job's command embeds the service-role key, so anyone with database access can read it.
4. **Open endpoint.** `process-queue` is deployed with `--no-verify-jwt`, and its handler never reads the request, so the key in the cron job protects nothing. Anyone who knows the URL can start a run.

Switching to a per-statement trigger without other changes would make processing much slower. Each run claims 5 rows and exits, so the cron would drain a 1,000-row CSV at 5 rows per 10 s, which is about 33 minutes.

## Decision

### Throughput: one paced drain loop

- **Only one worker drains at a time**, with at least **300 ms between Ahrefs calls across the whole run** (about 3 domains/s). A 1,000-domain CSV takes about 6 minutes.
- The goal is to protect the unauthenticated Ahrefs endpoint, whose real limit is unknown. We rejected parallel loops and adaptive pacing (see the last section).

### Database side

One migration: `supabase/migrations/20261011000000_worker_kick_vault.sql`. `schema.sql` is updated to the same end state.

**Vault entries.** Both are created by the provisioning command below and never committed:
- `worker_secret`: the shared secret;
- `worker_url`: the function URL. Storing it here removes the placeholders from `schema.sql`.

**`public.kick_worker()`.** This is the only caller of the edge function. It is `security definer`, uses `search_path = ''`, and has execute revoked from `public`/`anon`/`authenticated`.
1. It returns immediately unless a row is due. A row is due when it is `pending` with `available_at <= now()`, or `processing` with `claimed_at < now() - 2 minutes`. Because of this check, the cron never wakes an idle worker.
2. It reads `worker_secret` and `worker_url` from `vault.decrypted_secrets`. If either is missing, it raises a **warning** and returns. A missing secret must never make an insert, and therefore `/api/check`, fail.
3. It calls `net.http_post(worker_url, headers {Content-Type, x-worker-secret})`. The call is asynchronous, so the inserting transaction never waits on HTTP.

**Trigger.** `trg_urls_kick_worker` runs `AFTER INSERT ON public.urls REFERENCING NEW TABLE AS inserted FOR EACH STATEMENT`. It calls `kick_worker()` only if `inserted` contains a `pending` row, so fully cached checks start no run.

**Removed and replaced.**
- The dashboard webhook trigger `"process-queue"` is dropped.
- `process-queue-backstop` is rescheduled every 10 s as `select public.kick_worker()`. `cron.job` no longer contains any key, and the service-role key is no longer stored anywhere in the database.

**Lease.**
- Table `public.worker_lease` holds a single row (`id = 1`) with `holder uuid` and `expires_at timestamptz`. RLS is on and it has no policies.
- `acquire_worker_lease(p_holder uuid, p_ttl_seconds integer) returns boolean` takes the lease atomically when it is free, expired, or already held by `p_holder`. Calling it again renews the lease.
- `release_worker_lease(p_holder uuid)` frees the lease, but only for its current holder.
- Both RPCs are server-only, with execute revoked from `anon` and `authenticated`.
- We use a lease row rather than a Postgres advisory lock. The worker reaches Postgres through PostgREST, where every RPC is its own short session, so a session lock cannot be held across the loop.

### Worker side

The function lives in `supabase/functions/process-queue/`.

**Authentication** (`auth.ts`, pure):
- Each request must carry `x-worker-secret` equal to the function secret `WORKER_SECRET`, compared in constant time.
- If the header is wrong or missing, the function returns **401** and touches nothing.
- If `WORKER_SECRET` is unset, it returns **500** "worker not configured".

**Drain loop** (`drain.ts`, with dependencies injected for tests):
```
acquire lease (TTL 60 s) → not acquired? return 200 {"skipped":"busy"}
loop:
  stop if elapsed > 120 s   (edge wall-clock limit is 150 s; cron resumes)
  renew lease → lost? stop
  claim 5 rows → none? stop
  process the claimed rows (unchanged from ADR 0001: cache check,
    one Ahrefs call per domain, outcome.ts rules)
release lease → 200 {"processed": N, "iterations": K}
```
- Spacing is enforced across iterations by tracking when the last Ahrefs call happened.
- If the worker crashes, its lease expires within 60 s and the next cron tick takes over.
- These are unchanged: `outcome.ts`, `_shared/cache.ts`, `claim_pending_urls`, retries and backoff, and stuck-row reclaim.

### Secret provisioning

You run this once per environment. The value is never printed or committed, and you also run it to rotate the secret:

```
S=$(openssl rand -hex 32)
supabase secrets set WORKER_SECRET=$S
-- in SQL, with $S and the project's function URL substituted:
select vault.create_secret('<S>', 'worker_secret');
select vault.create_secret('https://<ref>.supabase.co/functions/v1/process-queue', 'worker_url');
```

To rotate, rerun it with `vault.update_secret` and the same `supabase secrets set`.

### Rollout order

The order guarantees processing never stops:

1. **Provision the secrets.** This has no effect yet, because the running function ignores headers.
2. **`db push` the migration.** The trigger and cron now send `x-worker-secret`. The old function ignores the header, so processing continues.
3. **Deploy the function.** It now enforces the secret, which the database is already sending.

Deploying the function first would open a gap. The old webhook sends no header, so every call would get a 401 until the migration ran.

## Consequences

- A 1,000-row CSV causes about 3–4 sequential worker runs instead of about 1,000 concurrent ones. Ahrefs sees at most about 3 requests/s from us.
- Large checks are slower than with the fan-out: about 6 minutes per 1,000 uncached domains instead of about 1 minute. Small checks are unaffected, because the trigger starts a run immediately.
- The whole processing setup can be reproduced from the repo (migration + `schema.sql` + provisioning command). The dashboard webhook step disappears from the setup docs.
- The worker endpoint is closed to callers who don't have the secret.
- No Supabase API key is stored in the database.
- When the queue is idle, the cron does a cheap "is anything due?" query and makes no HTTP call.
- A missing or mis-provisioned secret stops processing silently. Postgres logs a warning, the function returns 401/500, and rows stay `pending`. The verification step below catches this.

## Verification

- An unauthenticated call to the function URL returns 401.
- `cron.job` shows `select public.kick_worker()` with no key, and its recent runs succeeded. While idle, no new `net._http_response` rows appear.
- The `"process-queue"` webhook trigger is gone, and `trg_urls_kick_worker` exists.
- A typed check of 2 uncached domains completes inline within seconds.
- Re-checking the same 2 domains is fully cached and starts no worker run.
- A check of about 15 uncached domains is drained by one run, and the batch completes with at least about 300 ms between Ahrefs calls.
- `migration list` shows local = remote. `npm test`, `deno check` and `npm run build` pass.

## Rollback

1. Write a follow-up migration that recreates the row-level webhook trigger and the previous cron command, then run `db push`.
2. Redeploy the previous function from `main`.

The Vault entries and the lease table can stay; they are harmless.

## Alternatives rejected

- **Parallel drain loops (about 3×):** faster, but multiplies the request rate on an endpoint whose limit is unknown.
- **Adaptive pacing (speed up on 200, back off on 429):** better in principle, but it can't be tuned without production traffic.
- **Re-enabling JWT verification with the service-role key from Vault:** ties the worker to the legacy JWT keys Supabase is phasing out, and keeps a powerful key in the database.
- **Leaving the endpoint public:** the impact is low, but it leaves an open trigger for Ahrefs calls.
- **Starting runs from Nitro after `createCheck`:** Netlify may cut off work that continues after the response is sent, and the secret would also have to live in the Netlify environment.
- **Cron-only triggering:** adds up to 10 s of latency to the inline 1–10 domain lookups.
- **Generating the secret inside Postgres:** copying it to the function's secrets would require reading the plaintext back out of the database.
