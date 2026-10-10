# DR Checker — Ahrefs Domain Rating Directory

Nuxt 3 + Supabase app: type a few domains or upload a CSV of URLs, watch
server-side processing sync live to the browser, then download DR results as
CSV. No accounts. Every domain with a DR lands in a public domain directory
that doubles as a 30-day cache, so repeat lookups are instant.

## Architecture

```
┌─────────────┐  1. typed list / CSV ┌───────────────────────┐
│   Browser   │ ───────────────────▶ │ POST /api/check       │
│  (Nuxt UI)  │                      │ (Nitro server route)  │
└─────────────┘                      └──────────┬────────────┘
      ▲                                         │ per-IP rate limit
      │ 3. realtime                             │ reads `domains` cache (30 days)
      │ broadcast on                            │ inserts batch + url rows
      │ channel batch:<id>                      ▼   (cache hits already done)
      │                               ┌───────────────────────┐
      │                               │  Supabase Postgres    │
      ├───────── triggers ────────────┤  batches/urls/domains │
      │          realtime.send()      └──────────┬────────────┘
      │                                          │ kick_worker(): trigger + pg_cron
      │                                          ▼
      │                               ┌───────────────────────┐
      └───────────────────────────────┤ Edge Function:        │
                                      │ process-queue (Deno)  │
                                      │ - claims due urls     │
                                      │ - cache check, then   │
                                      │   Ahrefs free DR      │
                                      │ - retries w/ backoff  │
                                      │ - upserts `domains`   │
                                      └───────────────────────┘
```

Design decisions are recorded in `specs/adr/0001-domain-directory.md`.

### Why a Postgres queue + Edge Function (not just an in-process worker)?

Nitro server routes on most hosts (Vercel/Netlify functions, edge runtimes)
**do not keep running after the HTTP response is sent**. If we tried to loop
over a thousand URLs inside `/api/check`, the request would time out and the
client would hang waiting for a response.

Instead:

- `/api/check` does only fast work (rate-limit check, cache lookup, row
  inserts) and returns immediately with the new batch id and whether to show
  the results inline (typed checks of up to 10 domains) or on a results page.
- A Supabase **Edge Function** (`process-queue`) does the actual work. It's
  started two ways, both through `public.kick_worker()`, so processing starts
  fast *and* survives retries:
  1. **Statement trigger** `trg_urls_kick_worker` starts it once per INSERT
     that adds pending rows.
  2. **pg_cron** calls `kick_worker()` every 10s, which only starts the worker
     when rows are due (retries after backoff, rows stuck in `processing` for
     more than 2 minutes).

  Both send a shared secret held in Vault, and a single-row lease keeps one
  paced drain loop at a time (ADR 0002).
- Every batch's URLs land in the same `urls` table, so the queue naturally
  interleaves rows from different checks. Row claiming uses
  `FOR UPDATE SKIP LOCKED`, so concurrent invocations never process the same
  URL twice.
- DB triggers push each row change with `realtime.send()` to the private
  broadcast channel `batch:<id>`, and the browser subscribes to it (RLS lets
  anon receive but never send). If websockets fail or go quiet, the page polls
  `/api/status` until the batch finishes. The tables themselves are not
  readable with the anon key.

### Ahrefs integration

Ahrefs' free endpoint (`GET https://api.ahrefs.com/v3/public/domain-rating-free
?target=<domain>&output=json`) is rate-limited. So:
- Each submitted URL is normalized to its host (only a leading `www.` is
  stripped; hosts without a dot are rejected).
- A DR is cached in `domains` for 30 days ("no data" results for 7 days) and
  served from there before Ahrefs is called. Transient failures are never
  cached.
- Domains are de-duplicated per invocation, so Ahrefs is called once per
  unique domain.
- Transient failures (429, 5xx, network) are retried up to 3 times with a
  `30s × attempts` backoff; after that the last known (stale) DR is served if
  one exists.
- The Edge Function claims a small batch (5) per invocation with a short delay
  between calls, to stay under Ahrefs' rate limit.

## Project layout

```
supabase/schema.sql        End-state schema for fresh installs
supabase/migrations/       Upgrade for existing projects
supabase/functions/
  _shared/cache.ts         Cache TTLs + freshness rules (shared with Nitro)
  process-queue/index.ts   Edge Function: claims + processes due URLs
  process-queue/outcome.ts Pure retry / stale-fallback / cache-write rules
server/api/check.post.ts   Typed or CSV check: rate limit, cache lookup, inserts
server/api/domains.get.ts  Public domain directory (filters, sort, pagination)
server/api/status/[batchId].get.ts   Batch snapshot for first paint
server/api/download/[batchId].get.ts CSV export
server/utils/*.ts          Input parsing, check creation, rate limit, admin client
components/CheckResults.vue Live progress + results table + download button
pages/index.vue            Check form, inline results, domain directory
pages/results/[batchId].vue Results page for larger checks
composables/useBatchRealtime.ts  Realtime broadcast subscription hook
tests/                     Vitest unit tests (npm test)
```

## Setup

1. `supabase init` / link this repo to your Supabase project.
2. Fresh project: run `supabase/schema.sql` in the SQL editor. Existing
   project: run `supabase/migrations/20261007000000_domain_directory.sql`.
3. Realtime: the app uses private broadcast channels (receive-only for anon
   via the RLS policy in `schema.sql`); "Private channels only" may be enabled.
4. Deploy the edge function:
   ```
   supabase functions deploy process-queue --no-verify-jwt
   ```
5. Provision the worker secret:
   `SUPABASE_ACCESS_TOKEN=... scripts/provision-worker-secret.sh <project-ref>`
6. Copy `.env.example` to `.env` and fill in:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public, client-side)
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only — all table access goes
     through it, since the tables have no anon policies)
7. Use Node ≥ 22 (`nvm use` reads `.nvmrc`), then `npm install && npm run dev`; `npm test` runs the unit tests.
