# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Nuxt 3 + Supabase app: type domains (or upload a CSV of URLs) to check their Ahrefs Domain Rating. There are no accounts. Server-side processing syncs live to the browser via Supabase Realtime broadcast, and results can be downloaded as CSV. Every domain with a DR goes into a public domain directory (the `domains` table), which doubles as a 30-day cache. Design decisions are recorded in `specs/adr/0001-domain-directory.md`.

## Commands

```
npm run dev       # nuxt dev
npm run build     # nuxt build
npm run preview   # nuxt preview
npm test          # vitest (pure server/worker logic in tests/)
```

There's no lint script (`eslint` is a devDependency but has no script or config yet). `deno check supabase/functions/process-queue/index.ts` type-checks the edge function.

Requires **Node ≥ 22** (`.nvmrc` pins 24; run `nvm use`): `@supabase/supabase-js` needs the native `WebSocket` global at `createClient()` time, even on the server, and Node 20 fails every Supabase-backed route with "Node.js 20 detected without native WebSocket support".

Env vars (`.env`, see `.env.example`): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public), `SUPABASE_SERVICE_ROLE_KEY` (server-only). The Supabase edge function separately needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `AHREFS_DR_RATING`, set via `supabase secrets`. Hosting is Netlify (serverless Nitro), so no state is kept in memory between requests.

Supabase-side setup/deploy (not run by npm scripts):
```
# fresh project: paste supabase/schema.sql into the SQL editor
# existing project: run supabase/migrations/20261007000000_domain_directory.sql
supabase functions deploy process-queue --no-verify-jwt
```
Also required:
- run `scripts/provision-worker-secret.sh <project-ref>` once (and to rotate): it sets the function secret `WORKER_SECRET` and the Vault entries `worker_secret`/`worker_url` that `kick_worker()` uses (ADR 0002);
- Realtime set to allow public channels.

## Architecture

```
Browser --typed list / CSV--> POST /api/check (Nitro)
                                |  per-IP rate limit (register_check_request)
                                |  reads `domains` cache; inserts batch + urls
                                |  (fresh cache hits inserted already done)
                                v
                          Supabase Postgres
                                |  kick_worker(): statement trigger + pg_cron (10s), x-worker-secret
                                v
                   Edge Function: process-queue (Deno)
                     - one leased drain loop: claims 5 due urls at a time (SKIP LOCKED, reclaims stuck rows), ≥300 ms between Ahrefs calls, 120 s budget
                     - checks `domains` again, else calls Ahrefs (once per domain)
                     - updates url rows, upserts `domains`
Browser <--Realtime broadcast `batch:<id>`-- triggers (realtime.send)
```

**Why a Postgres queue + Edge Function instead of an in-process worker:** Nitro routes on most hosts don't keep running after the HTTP response is sent, so `/api/check` can't loop over a thousand URLs synchronously. It only does fast work (rate limit, cache lookup, row inserts) and returns immediately with `{ batchId, total, resolved, queued, skipped, display }`. All actual processing happens in the `process-queue` edge function, which is triggered two ways for speed and resilience: the statement-level trigger `trg_urls_kick_worker` (once per INSERT that adds pending rows) and a pg_cron call every 10 s, both via `public.kick_worker()`, which only calls the function when rows are due and authenticates with a Vault-held shared secret. A single-row `worker_lease` keeps one drain loop at a time (ADR 0002).

**Concurrency and recovery:** every check's URLs land in the same `urls` table and are processed by the same worker pool. `claim_pending_urls()` (in `schema.sql`) takes rows that are `pending` with `available_at <= now()`, plus rows stuck in `processing` for more than 2 minutes (`claimed_at`), so crashed invocations recover. It uses `FOR UPDATE SKIP LOCKED`, so concurrent invocations never double-process a row. Each claim increments `urls.attempts`.

**Client sync:** the client never polls by hand. AFTER UPDATE triggers `broadcast_url_change`/`broadcast_batch_change` call `realtime.send(..., 'batch:' || id, private => false)` with client-facing fields only. `composables/useBatchRealtime.ts` subscribes to that public channel *before* fetching the `/api/status/[batchId]` snapshot (rows received live win over the snapshot), so fast checks can't finish in the gap. `batches`/`urls` are not readable with the anon key; knowing the batch UUID is the only way to listen.

**Batch progress rollup:** `bump_batch_progress()` (a Postgres trigger on `urls` UPDATE, in `schema.sql`) recomputes `batches.processed_urls`/`status` whenever a url row transitions to `done`/`error`. Rows inserted already resolved (cache hits) don't fire it, so `/api/check` seeds `processed_urls` and marks the batch `completed` when nothing is queued. Otherwise, don't increment progress counters from Nitro or the edge function.

**Health check:** batch counters should always match their url rows. This read-only query lists any batch whose `processed_urls` drifted; it should return no rows. `supabase/migrations/20261010000000_repair_batch_progress.sql` repaired the batches that drifted before the row-lock fix.
```sql
select b.id, b.processed_urls, count(*) filter (where u.status in ('done','error')) as actual
from public.batches b join public.urls u on u.batch_id = b.id
group by b.id having b.processed_urls <> count(*) filter (where u.status in ('done','error'));
```

**Results display:** typed checks with ≤ 10 valid rows render inline on the home page at `/?check=<id>` (via `components/CheckResults.vue`). Typed checks of 11–100 rows and every CSV redirect to `/results/<id>`.

### Ahrefs integration and cache

Ahrefs' free DR endpoint (`GET https://api.ahrefs.com/v3/public/domain-rating-free`) is rate-limited, so the pipeline works as follows:
- **Normalization:** every submitted URL is reduced to its host (`server/utils/domain.ts` `normalizeDomain`). Only a leading `www.` is stripped, so `blog.example.com` stays separate from `example.com`. Hosts without a dot are rejected.
- **Cache:** the `domains` table stores the latest result per domain. `ok` rows are fresh for 30 days and `no_data` rows (Ahrefs returned 200 without a numeric DR) for 7 days. These TTLs and `isFresh` live in `supabase/functions/_shared/cache.ts`, which both Nitro and Deno import. Transient failures are never cached. A DR of 0 is a valid success.
- **Retries:** a transient failure (non-200 or network) requeues the row with `available_at = now() + 30s × attempts`. After 3 attempts the row becomes `done` with the stale DR (`source = stale`) if one exists, otherwise `error`. These rules are in `supabase/functions/process-queue/outcome.ts` (pure, unit-tested).
- **Provenance:** `urls.source` ∈ `live | cache | stale | no_data`, with `urls.checked_at` recording when the DR was actually fetched.
- **Pacing:** domains are de-duplicated per `process-queue` invocation (one Ahrefs call per domain). Each invocation claims `CLAIM_SIZE = 5` rows, with `AHREFS_DELAY_MS = 300` between calls.

### No accounts

There is no auth. Batches are anonymous, and the batch UUID in the results link is the only key. All DB access goes through `server/utils/supabaseAdmin.ts` (the service-role client). Every table has RLS enabled with **no** policies, and the RPCs (`claim_pending_urls`, `register_check_request`) have execute revoked from `anon`/`authenticated`. `/api/check` allows 10 requests/min per IP, using the `check_requests` table with the IP from `x-nf-client-connection-ip`. The caps are 100 typed domains and 1,000 CSV rows (valid entries only).

### Key files

- `supabase/schema.sql`: end-state tables, triggers (`bump_batch_progress`, `set_updated_at`, broadcast triggers), the `claim_pending_urls()`/`register_check_request()` RPCs, RLS, and the pg_cron jobs
- `supabase/migrations/20261007000000_domain_directory.sql`: upgrade from the pre-directory schema
- `supabase/functions/_shared/cache.ts`: cache TTLs, `isFresh`, `cachedUrlFields`
- `supabase/functions/process-queue/index.ts` and `outcome.ts`: the Deno edge function worker and its pure decision rules
- `server/api/check.post.ts`: entry point for typed and CSV checks (validate → rate limit → write)
- `server/utils/checkInput.ts` (pure parsing, caps, cache planning), `createCheck.ts` (DB writes), `rateLimit.ts`
- `server/utils/domain.ts`: `normalizeDomain`
- `server/utils/supabaseAdmin.ts`: the service-role client. **Server-only**; never import it from client code
- `server/api/domains.get.ts`: the public domain directory (only `domains.status = 'ok'`)
- `composables/useSupabase.ts`: anon-key browser client (used only for Realtime)
- `composables/useBatchRealtime.ts`: the broadcast subscription hook
- `components/CheckResults.vue`: the results table shared by the home page and `/results/[batchId]`
- `specs/adr/`: architecture decision records; `specs/`: implementation plans
- `tests/`: Vitest unit tests
