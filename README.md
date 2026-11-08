# DR Checker — Ahrefs Domain Rating Directory

[![CI](https://github.com/braanj/DR-checker/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/braanj/DR-checker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Live demo](https://img.shields.io/badge/demo-dr--bulkchecker.netlify.app-00C7B7?logo=netlify&logoColor=white)](https://dr-bulkchecker.netlify.app)
[![Node ≥ 22](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)](.nvmrc)
[![Nuxt 3](https://img.shields.io/badge/Nuxt-3-00DC82?logo=nuxt&logoColor=white)](https://nuxt.com)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Edge%20Functions-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Nuxt 3 + Supabase app: type a few domains or upload a CSV of URLs, watch
server-side processing sync live to the browser, then download DR results as
CSV. No accounts. Every domain with a DR lands in a public domain directory
that doubles as a 30-day cache, so repeat lookups are instant, and gets its
own SEO page with DR history.

**Live:** https://dr-bulkchecker.netlify.app

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

Design decisions are recorded in `specs/adr/` (0001 domain directory, 0002 worker trigger and secret, 0003 domain pages and metadata).

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
supabase/schema.sql          End-state schema for fresh installs
supabase/migrations/         Applied migration history
supabase/tests/              Rollback-only SQL scenario tests
supabase/functions/
  _shared/                   Cache rules, worker auth, generated DB types
  process-queue/             Edge Function: claims due URLs, calls Ahrefs, retries
  fetch-meta/                Edge Function: favicon, title and description via safeFetch
server/api/check.post.ts     Typed or CSV check: validate, rate limit, cache lookup, inserts
server/api/domains.get.ts    Public domain directory (filters, sort, pagination)
server/api/domains/export.post.ts  CSV export of selected domains
server/api/domain/[domain].get.ts  One domain's DR, history and metadata
server/api/status/[batchId].get.ts Batch snapshot for first paint
server/api/download/[batchId].get.ts Results CSV
server/utils/                Input parsing, check creation, rate limits, queries, CSV
pages/                       Check page, /domains, /domain/<domain>, /results/<id>, /docs
components/                  App shell, results table, directory table and filters
composables/useBatchRealtime.ts  Realtime broadcast subscription with polling fallback
tests/                       Vitest unit tests (npm test)
```

## Setup

You need Node 22 or newer (`.nvmrc` pins 24; run `nvm use`), a Supabase project,
and an Ahrefs API key. Node 20 doesn't work, because supabase-js needs the native
`WebSocket`.

1. Install: `npm install`. This also runs `nuxt prepare`, which the tests need.
2. Copy `.env.example` to `.env` and fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ACCESS_TOKEN`. The service-role key is
   server-only: all table access goes through it, since the tables have no anon
   policies.
3. Create the schema. Link the project with
   `npx -y supabase@2.109.0 link --project-ref <project-ref>`, then apply every
   migration with `npx -y supabase@2.109.0 db push`.
4. Deploy both edge functions:
   ```
   npx -y supabase@2.109.0 functions deploy process-queue --no-verify-jwt
   npx -y supabase@2.109.0 functions deploy fetch-meta --no-verify-jwt
   ```
5. Set the Ahrefs key the worker sends as a bearer token:
   `npx -y supabase@2.109.0 secrets set AHREFS_DR_RATING=<your-ahrefs-api-key>`
6. Provision the worker secret and its Vault entries (safe to re-run to rotate):
   `SUPABASE_ACCESS_TOKEN=... scripts/provision-worker-secret.sh <project-ref>`
7. In the Supabase dashboard, enable Realtime's "Private channels only". The app
   uses private, receive-only broadcast channels.
8. Run it: `npm run dev`. Check your work with `npm test`, `npm run typecheck`
   and `npm run build`. After a schema change, `npm run gen:types` regenerates the
   database types from the project in your `.env`.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first,
and follow the [code of conduct](CODE_OF_CONDUCT.md). Notable changes are listed in
[CHANGELOG.md](CHANGELOG.md).

## Security

Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Brahim Anjjar
