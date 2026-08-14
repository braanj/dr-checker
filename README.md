# DR Checker — Bulk Ahrefs Domain Rating Tool

Nuxt 3 + Supabase app: upload a CSV of URLs, get an auto-generated account,
watch server-side processing sync live to the browser, then download DR
results as CSV.

## Architecture

```
┌─────────────┐   1. upload CSV    ┌───────────────────────┐
│   Browser   │ ─────────────────▶ │ POST /api/upload      │
│  (Nuxt UI)  │                    │ (Nitro server route)  │
└─────────────┘                    └──────────┬────────────┘
      ▲                                        │ creates auth user (admin API)
      │ 3. realtime                            │ inserts batch + url rows (status=pending)
      │ postgres_changes                       ▼
      │                              ┌───────────────────────┐
      │                              │  Supabase Postgres    │
      │                              │  batches / urls       │
      │                              └──────────┬────────────┘
      │                                        │ NOTIFY (webhook) + pg_cron backstop
      │                                        ▼
      │                              ┌───────────────────────┐
      └──────────────────────────────┤ Edge Function:        │
                                     │ process-queue (Deno)  │
                                     │ - claims pending urls │
                                     │ - calls Ahrefs free   │
                                     │   DR endpoint         │
                                     │ - updates row + batch │
                                     └───────────────────────┘
```

### Why a Postgres queue + Edge Function (not just an in-process worker)?

Nitro server routes on most hosts (Vercel/Netlify functions, edge runtimes)
**do not keep running after the HTTP response is sent**. If we tried to loop
over thousands of URLs inside `/api/upload`, the request would time out and
the client would hang waiting for a response.

Instead:

- `/api/upload` does only fast writes (create user, insert rows) and returns
  immediately with the new batch id + generated credentials.
- A Supabase **Edge Function** (`process-queue`) does the actual work. It's
  invoked two ways so processing starts fast *and* survives retries/scaling:
  1. **Database Webhook** fires it the instant new `urls` rows are inserted.
  2. **pg_cron** calls it every 5–10s as a backstop, so it also picks up any
     batch that stalled (crashed invocation, cold start, etc.).
- This design gives you **"multiple processes" for free**: every batch's URLs
  land in the same `urls` table, so the queue naturally interleaves rows from
  different users/batches. You can also run several concurrent Edge Function
  invocations (Supabase scales them horizontally) — row claiming uses
  `FOR UPDATE SKIP LOCKED` so two workers never process the same URL twice.
- The client never polls processing status by hand — it opens a Supabase
  **Realtime** channel on `postgres_changes` for its batch, so progress
  updates arrive the moment a row is updated server-side. That's the
  "sync with server" requirement, with no extra polling infrastructure.

### Ahrefs integration

Ahrefs' free endpoint (`GET https://api.ahrefs.com/v3/public/domain-rating-free
?target=<domain>&output=json`) returns **domain-level** DR, is unauthenticated,
but is rate-limited. So:
- We normalize each submitted URL down to its registrable domain before
  querying (e.g. `https://sub.example.com/page` → `example.com`).
- We de-duplicate domains **within a batch** so we only call Ahrefs once per
  unique domain, then fan the result back out to every URL row that shares it.
- The Edge Function claims/processes a small batch (e.g. 5) per invocation
  with a short delay between calls, to stay well under Ahrefs' rate limit.

## Project layout

```
supabase/schema.sql        Tables, RLS policies, realtime publication, cron
supabase/functions/
  process-queue/index.ts   Edge Function: claims + processes pending URLs
server/api/upload.post.ts  Create account + batch + url rows, kick off processing
server/api/status/[batchId].get.ts   Batch summary (fallback for non-realtime clients)
server/api/download/[batchId].get.ts CSV export
server/utils/*.ts          Supabase admin client, domain normalization, CSV helpers
pages/index.vue            Upload form
pages/results/[batchId].vue Live progress + results table + download button
composables/useBatchRealtime.ts  Realtime subscription hook
```

## Setup

1. `supabase init` / link this repo to your Supabase project.
2. Run `supabase/schema.sql` in the SQL editor (or `supabase db push`).
3. Deploy the edge function:
   ```
   supabase functions deploy process-queue --no-verify-jwt
   ```
4. Create the Database Webhook: Dashboard → Database → Webhooks →
   new webhook on `urls` INSERT → calls `process-queue`.
5. Enable the cron backstop (inside `schema.sql`, using `pg_cron` +
   `pg_net`, already wired to call the function URL every 10s).
6. Copy `.env.example` to `.env` and fill in:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public, client-side)
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only — used to create auth users
     and bypass RLS for inserts)
7. `npm install && npm run dev`
