# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Nuxt 3 + Supabase app, live at https://dr-bulkchecker.netlify.app.

- **Checking:** type domains (≤ 100) or upload a CSV (≤ 1,000 valid rows) to get their Ahrefs Domain Rating. There are no accounts.
- **Processing:** server-side and paced. Progress streams to the browser over private Realtime broadcasts, and results download as CSV.
- **Directory:** every domain with a DR joins the public directory (the `domains` table, which doubles as a 30-day cache), browsable at `/domains` (sortable table, selection, CSV export). Each one gets an SEO page at `/domain/<domain>` with DR history, plus its favicon, title and description fetched in the background.

**Design history lives in `specs/adr/`** (0001 domain directory, 0002 worker trigger/secret, 0003 domain pages and metadata). Implementation plans are in `specs/`. Read the relevant ADR before changing a subsystem it covers.

## Commands and environment

The scripts are in `package.json`. Facts the files don't tell you:

- **Node ≥ 22** (`.nvmrc` pins 24; `nvm use`, or prefix `PATH=$HOME/.nvm/versions/node/v24.16.0/bin:$PATH`). supabase-js needs the native `WebSocket` at `createClient()` time, even on the server. Node 20 fails every Supabase route with "Node.js 20 detected without native WebSocket support".
- **Gates for every change:** `npm test`, `npm run typecheck` (must be 0 errors) and `npm run build`. For each edge function touched, also run `deno check supabase/functions/<fn>/index.ts`, then delete the `deno.lock` it creates. The edge entrypoints are excluded from `tsconfig.json` (Deno globals), so only `deno check` covers them.
- **Supabase CLI:** use `npx -y supabase@2.109.0 …` with `SUPABASE_ACCESS_TOKEN` taken from `.env`. There's no global CLI, no Docker, and no `gh`.
- **Env (`.env`):** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only), `SUPABASE_ACCESS_TOKEN` (CLI / Management API), optional `SITE_URL`. Edge-function secrets live in `supabase secrets`: `AHREFS_DR_RATING` and `WORKER_SECRET`.
- **Hosting is Netlify** (serverless Nitro), so keep no in-memory state between requests. Netlify deploys on merge to `main`.

## Working rules (production)

- **Every schema change is a migration file** in `supabase/migrations/`, mirrored into `supabase/schema.sql` (the end state, for fresh installs). Apply it with `npx -y supabase@2.109.0 db push`, then run `npm run gen:types` and commit the regenerated `supabase/functions/_shared/database.types.ts`.
- **Who runs what:**
  - Claude: `db push` and `functions deploy process-queue|fetch-meta --no-verify-jwt` (allow-listed in `.claude/settings.local.json`), plus read-only checks through the Management API (`"read_only": true`).
  - The user: data repairs, SQL scenario tests, and `scripts/provision-worker-secret.sh`. Give them a ready-to-paste `! …` command.
- **Release order:** branch, then implement with tests first, then push the DB/function changes from the branch, verify on production, push the branch, and open a PR through a prefilled `https://github.com/braanj/DR-checker/compare/main...<branch>?expand=1&title=…&body=…` URL. The user merges. Afterwards, sync `main`, delete the branch, and verify the deployed site.
- **SQL scenario tests** (`supabase/tests/*.sql`) are one `do` block that always ends by raising an exception, so everything rolls back. Success is the error text `SCENARIO OK`.
- **Read-only Management API queries** run as a role that cannot execute functions revoked from `public` (e.g. `meta_due`). Query the tables directly instead.
- **Health check** (should return no rows): `select b.id from public.batches b join public.urls u on u.batch_id = b.id group by b.id having b.processed_urls <> count(*) filter (where u.status in ('done','error'));`

## Architecture

```
Browser --typed list / CSV--> POST /api/check (Nitro)
                                |  validate → per-IP rate limit → cache lookup → insert batch + urls
                                v  (fresh cache hits inserted already done)
                          Supabase Postgres
                                |  kick_worker(): statement trigger + pg_cron (10 s), x-worker-secret from Vault
                                v
              Edge Function process-queue: one leased, paced drain loop → Ahrefs → urls, domains, domain_history
Browser <--private Realtime broadcast `batch:<id>`-- AFTER UPDATE triggers (realtime.send)

pg_cron (1 min) → kick_meta_worker() → Edge Function fetch-meta → safeFetch → domain_meta + favicons bucket
```

- **Why a queue + edge functions:** Nitro on Netlify can't keep working after the response is sent, so `/api/check` only does fast writes and returns `{ batchId, total, resolved, queued, skipped, display }`.
- **Worker (`process-queue`, ADR 0002):**
  - `kick_worker()` calls it only when rows are due, authenticating with the Vault-held shared secret (`x-worker-secret`, checked by `_shared/auth.ts`).
  - The single-row `worker_lease` keeps one drain loop at a time.
  - The loop's time limits are tied together and pinned by `tests/workerLimits.test.ts`: lease TTL vs worst-case iteration, budget vs the 150 s wall clock, and pg_net timeout vs run length. Change them in `drain.ts` only with that test green.
- **Claiming:** `claim_pending_urls()` takes `pending` rows whose `available_at` has passed, plus `processing` rows stuck for more than 2 minutes, using `FOR UPDATE SKIP LOCKED`. Each claim increments `attempts`.
- **Retries:** decided by `process-queue/outcome.ts` (pure, tested). Transient failures back off at 30 s × attempts. After 3 attempts the row ends `done/stale` (if an old DR exists) or `error`. Transient failures are never cached; a DR of 0 is a success.
- **Cache:** `domains` holds the latest result per domain. `ok` stays fresh for 30 days and `no_data` for 7 (`_shared/cache.ts`, imported by both Nitro and Deno).
- **Batch status** is owned by Postgres:
  - `bump_batch_progress()` recounts on every url status change and ends a batch `completed`, or `failed` if every row errored.
  - `claim_pending_urls()` flips `pending` → `processing` on the first claim.
  - `initialBatchStatus()` (`server/utils/checkInput.ts`) sets the status at insert time, including fully cache-answered batches.
  - Never increment progress counters from Nitro or the workers.
- **Client sync:**
  - Triggers broadcast client-facing fields to **private** channels. An RLS policy on `realtime.messages` lets anon *receive* `batch:*`; with no insert policy, nobody can send.
  - "Private channels only" is **enabled** in the Supabase dashboard, so a public channel subscription gets nothing.
  - `useBatchRealtime` subscribes (`{ private: true }`) *before* loading the `/api/status` snapshot (live rows win over the snapshot).
  - If the channel fails or stays silent for 10 s while a batch is unfinished, it polls `/api/status` every 5 s (`utils/realtimePoll.ts`).
- **Results display:** typed checks with ≤ 10 valid rows render inline at `/?check=<id>`. Everything else redirects to `/results/<id>`. Both use `components/CheckResults.vue`. The check page also lists "My recent checks" (`utils/recentChecks.ts`, localStorage `dr-recent-checks`); the directory lives at `/domains`, not on the check page.
- **App shell:** `layouts/default.vue` + `components/AppSidebar.vue` (active section from `utils/navSection.ts`). The collapsed state is `localStorage['dr-sidebar']` plus a pre-paint `<html data-sidebar="collapsed">`, deliberately not a cookie because `/domain/*` is CDN-cached.
- **Domains page:** `pages/domains.vue` + `components/domains/*`, server-rendered via `useFetch` keyed on the URL query (`utils/domainsTable.ts` maps route ⇄ state). `GET /api/domains` (pageSize 20|50|100, `sortBy` incl. `dr_change`; rows carry `dr_change`, title, favicon, `trend`) is built by pure `server/utils/domainsQuery.ts` + `domainTrends.ts` and the `/domains` page HTML is sent with `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` on success only (503 + `no-store` when the fetch fails). `domains.dr_change` is maintained by the AFTER INSERT/UPDATE trigger `refresh_dr_change` on `domain_history`; trends come from the `domain_trends(p_domains, p_n)` RPC.
- **Selection and export:** the selection persists in sessionStorage `dr-domains-selection` (`utils/domainSelection.ts`, cap 1,000). `POST /api/domains/export` takes ≤ 1,000 domains and returns a CSV (`server/utils/domainsCsv.ts`, formula-injection guard, queried 200 at a time).
- **Normalization:** `normalizeDomain` (`server/utils/domain.ts`) reduces input to the host and strips only a leading `www.`, so subdomains stay separate. Hosts without a dot are rejected.

### Domain pages and metadata (ADR 0003)

- **History:** the worker appends `domain_history` on every `ok` reading.
- **`/domain/[domain]`** is server-rendered from `/api/domain/[domain]`:
  - 200 with SEO head tags and the CDN cache header **only** when the domain has an `ok` DR;
  - unknown domains → 404 + `noindex` with a check button;
  - a database/API failure → 503 without `noindex` (so a blip never de-indexes pages);
  - non-canonical spellings → 301.
- **Crawling:** `/sitemap.xml` (read page by page until an empty page) and `/robots.txt` are server routes. `siteBase()` strips any trailing slash from `SITE_URL`.
- **`fetch-meta`** claims one due domain at a time through `claim_meta_domains` (the cadence is in `meta_due()`). It finalizes a domain as `error` after 3 runs that never finished. Every finished outcome clears `claimed_at` (`metaOutcome.ts`). The last good title/description stay visible when a refresh errors.
- **`safeFetch.ts` is the security boundary** for outbound requests: scheme/port allowlist, every resolved address on every redirect hop checked by `netguard.ts` (which fails closed), DNS bounded by the per-domain deadline, manual redirects, and byte caps. Limits are in `META_LIMITS`, pinned by `tests/metaLimits.test.ts`. Route every new outbound fetch through it.
- **Favicons** live in the public `favicons` bucket (100 KB, image-type allowlist enforced by the bucket too).

### Access model

- There is no auth. A batch's UUID is its only key.
- All DB access goes through `server/utils/supabaseAdmin.ts` (service role, typed `createClient<Database>`). It is **server-only**.
- Every table has RLS on and no policies. Every RPC has execute revoked from `public`/`anon`/`authenticated`.
- The browser's anon client (`composables/useSupabase.ts`) is used only for Realtime.
- `/api/check` and `/api/domains/export` each allow 10 requests/min per IP, in separate buckets (`check_requests.kind` = `check`|`export`; `register_check_request(p_ip, p_limit, p_kind)`, `assertRateLimit(event, kind)`; IP from `x-nf-client-connection-ip`), and send `Retry-After: 60` on 429.
- `status`/`source` columns are `text` + CHECK, so the generated types say `string`. Narrow them with an explicit cast where you read them.

## Where things are

- `supabase/schema.sql`: the end-state schema. `supabase/migrations/`: applied history.
- `supabase/functions/process-queue/`: `drain.ts` (loop and limits), `outcome.ts` (decisions), `index.ts` (wiring).
- `supabase/functions/fetch-meta/`: `safeFetch.ts`, `netguard.ts`, `parseHead.ts`, `metaOutcome.ts`, `index.ts`.
- `supabase/functions/_shared/`: `auth.ts`, `cache.ts`, `database.types.ts` (generated).
- `server/api/check.post.ts`: the check entry point. `server/api/domains/export.post.ts`: the CSV export. `server/api/domains.get.ts`: the directory listing.
- `server/utils/`: `checkInput.ts` (pure parsing, caps, cache planning), `createCheck.ts`, `rateLimit.ts`, `sitemap.ts`, `domainsQuery.ts`, `domainTrends.ts`, `domainsCsv.ts`.
- `layouts/default.vue`, `components/AppSidebar.vue`, `components/domains/*`.
- `pages/domain/[domain].vue`, `pages/domains.vue`, `pages/results/[batchId].vue`, `pages/index.vue`, `pages/docs.vue` (sticky TOC with scroll-spy).
- `utils/` (auto-imported in the app): `domainPath`, `domainView` (SEO text, `formatDr`, `siteBase`, `metaViewFrom`, sparkline), `checkedAgo`/`isoDate`, `retry`, `realtimePoll`, `navSection`, `recentChecks`, `domainsTable` (`drBand`, `formatDelta`, `pageRange`), `domainSelection`.
- `scripts/provision-worker-secret.sh <project-ref>`: provisions or rotates `WORKER_SECRET` and the Vault entries `worker_secret`, `worker_url` and `meta_worker_url`. Run it once per project; rotating is safe (crons retry).
- `tests/`: Vitest unit tests. `supabase/tests/`: rollback-only SQL scenarios.
