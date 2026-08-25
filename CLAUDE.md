# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Nuxt 3 + Supabase app: upload a CSV of URLs, get an auto-generated account, watch server-side processing sync live to the browser via Supabase Realtime, then download DR (Ahrefs Domain Rating) results as CSV.

## Commands

```
npm run dev       # nuxt dev
npm run build     # nuxt build
npm run preview   # nuxt preview
```

No test suite or lint script is configured (`eslint` is a devDependency but there's no lint script/config yet).

Env vars (`.env`, see `.env.example`): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public), `SUPABASE_SERVICE_ROLE_KEY` (server-only). The Supabase edge function separately needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AHREFS_DR_RATING` set via `supabase secrets`.

Supabase-side setup/deploy (not run by npm scripts):
```
supabase db push                                    # or paste supabase/schema.sql into SQL editor
supabase functions deploy process-queue --no-verify-jwt
```
Also requires a Database Webhook (`urls` INSERT → `process-queue`) configured in the Supabase dashboard, and the pg_cron backstop job defined at the bottom of `schema.sql` (has `<PROJECT_REF>`/`<SERVICE_ROLE_KEY>` placeholders to fill in after deploy).

## Architecture

```
Browser --upload CSV--> POST /api/upload (Nitro)
                              |  creates auth user (admin API)
                              |  inserts batches + urls rows (status=pending)
                              v
                        Supabase Postgres
                              |  NOTIFY (webhook) + pg_cron backstop (10s)
                              v
                 Edge Function: process-queue (Deno)
                   - claims pending urls (FOR UPDATE SKIP LOCKED)
                   - calls Ahrefs free DR endpoint (deduped per domain)
                   - updates url + batch rows
Browser <--Realtime (postgres_changes)-- Postgres
```

**Why a Postgres queue + Edge Function instead of an in-process worker:** Nitro routes on most hosts don't keep running after the HTTP response is sent, so `/api/upload` can't loop over thousands of URLs synchronously. It only does fast writes (create user, insert rows) and returns immediately with the batch id + generated credentials. All actual processing happens in the `process-queue` edge function, triggered two ways for speed + resilience: a Database Webhook on `urls` INSERT (fast start), and a pg_cron call every ~10s as a backstop that also recovers stalled/crashed invocations.

**Concurrency model:** every batch's URLs land in the same `urls` table, so multiple batches/users are naturally interleaved and processed by the same worker pool. `claim_pending_urls()` (in `schema.sql`) uses `FOR UPDATE SKIP LOCKED` so concurrent edge function invocations never double-process a row — this is what makes horizontal scaling of the edge function safe.

**Client sync:** the client never polls by hand. `composables/useBatchRealtime.ts` opens a Supabase Realtime channel on `postgres_changes` for the batch's `batches` and `urls` rows, so progress arrives the moment a row changes server-side. `server/api/status/[batchId].get.ts` is only a one-shot snapshot for first paint / graceful degrade if websockets are blocked — it is not the primary sync path.

**Batch progress rollup:** `bump_batch_progress()` (a Postgres trigger on `urls` UPDATE, in `schema.sql`) recomputes `batches.processed_urls`/`status` whenever a url row transitions to `done`/`error`. This is DB-side, not application code — don't try to increment progress counters from Nitro or the edge function.

### Ahrefs integration

Ahrefs' free DR endpoint (`GET https://api.ahrefs.com/v3/public/domain-rating-free`) scores at the **domain** level, is unauthenticated but rate-limited. So the pipeline:
- normalizes every submitted URL down to its bare domain (`server/utils/domain.ts` `normalizeDomain`, e.g. `https://sub.example.com/page` → `example.com`; strips `www.`)
- de-dupes domains within each `process-queue` invocation so Ahrefs is called once per unique domain, then fans the result back out to every url row sharing it
- claims/processes only `CLAIM_SIZE = 5` rows per edge function invocation with an `AHREFS_DELAY_MS = 300` spacing between calls, to stay under Ahrefs' rate limit

### Auth model

There's no login flow — `/api/upload` auto-creates a throwaway Supabase auth user per upload (`generateCredentials()` in `server/utils/domain.ts` generates a random adjective-noun email + password) and returns the credentials in the response. RLS policies in `schema.sql` restrict `batches`/`urls` reads to their owning `user_id`, but all app writes go through `server/utils/supabaseAdmin.ts` (service-role client, bypasses RLS) — RLS is effectively read-only protection for the generated account, not the app's access-control mechanism. `server/api/domains.get.ts` (public domain history) intentionally reads via the service-role client too, since it's cross-user by design.

### Key files

- `supabase/schema.sql` — tables, triggers (`bump_batch_progress`, `set_updated_at`), `claim_pending_urls()` RPC, RLS policies, realtime publication, `domain_summary` view, pg_cron job
- `supabase/functions/process-queue/index.ts` — the Deno edge function worker described above
- `server/api/upload.post.ts` — CSV parsing (bare list or `url` column), account/batch/url creation
- `server/utils/domain.ts` — `normalizeDomain`, `generateCredentials`
- `server/utils/supabaseAdmin.ts` — service-role client; **server-only**, never import from client code
- `composables/useSupabase.ts` — anon-key browser client
- `composables/useBatchRealtime.ts` — the realtime subscription hook
