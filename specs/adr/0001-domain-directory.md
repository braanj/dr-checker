# ADR 0001: Lookup-first public domain directory

- **Status:** Accepted
- **Date:** 2026-10-07

## Context

The app today is CSV-first: uploading a file auto-creates a throwaway Supabase auth user, inserts a batch, and the results page syncs via Realtime `postgres_changes` gated by per-user RLS. A cross-user "previously checked domains" table (the `domain_summary` view) already exists on the home page.

We want the app to be a **public directory of domains** where the primary action is typing one or more domains and seeing their Ahrefs DR, with CSV upload kept as a secondary input. Ahrefs' free DR endpoint is rate-limited, so re-using recent results matters. The app is deployed on Netlify (serverless Nitro), so no in-process state survives between requests.

## Decision

### Product

| Area | Decision |
|---|---|
| Input | Typed: max 100 domains, one per line or comma-separated. CSV: max 1,000 valid entries after normalization (previously 5,000). Invalid rows don't count toward the cap. |
| Results UI | Typed checks of 1–10 domains render inline on the home page, which updates its URL to `/?check=<id>` (refresh/share restores the inline view). Typed 11–100 and every CSV redirect to `/results/<id>`. |
| Directory | Every domain with a successful DR is listed publicly. One line of copy under the input says so. Existing filters/sort/pagination are kept. |
| Accounts | None. Batches are anonymous; the unguessable batch UUID in the link is the only key. Existing results links keep working. |
| Normalization | Full host, only a leading `www.` stripped (`normalizeDomain` unchanged). `blog.example.com` and `example.com` are separate entries. |

### Cache

- New `domains` table is both the directory and the cache: `domain text primary key, dr numeric null, status text check (status in ('ok','no_data')), checked_at timestamptz not null`.
- `ok` rows are fresh for **30 days**. `no_data` rows (Ahrefs returned 200 without a numeric DR) are fresh for **7 days** and are hidden from the directory.
- HTTP errors, 429s and network failures are **never** cached.
- A DR of `0` is a valid success.
- If a stale domain's re-check fails after all retries, the stale DR is served (`source = stale`) and the directory value is kept.

### Provenance

Each `urls` row records `source` ∈ `live | cache | stale | no_data` and `checked_at` (when the DR was actually fetched). The results table shows a badge plus "checked N days ago"; the CSV download gains `source` and `checked_at` columns.

### Processing

- `/api/check` resolves fresh cache hits at insert time (`done/cache`, or `error/no_data`) and queues only the rest as `pending`. Because `bump_batch_progress` fires on UPDATE only, the API seeds `batches.processed_urls` with the pre-resolved count, and sets `status = 'completed'` when nothing is queued.
- The `process-queue` edge function checks `domains` for a fresh row before calling Ahrefs (another batch may have just fetched it), and upserts `domains` after each definitive result.
- Transient failures re-queue the row: `attempts++`, `available_at = now() + 30s × attempts`. After **3** attempts → `done/stale` if a stale value exists, else `error`.
- `claim_pending_urls` claims `pending` rows with `available_at <= now()` **and** reclaims `processing` rows whose `claimed_at` is older than **2 minutes** (crashed/timed-out invocations); a reclaim counts as an attempt.

### Live sync

- `batches` and `urls` keep RLS enabled with **no** anon policies; nothing in them is readable with the anon key.
- AFTER UPDATE triggers on both tables call `realtime.send(payload, '<url|batch>', 'batch:' || batch_id, false)` with only client-facing fields (url: `id, original_url, domain, dr, status, error_message, source, checked_at`; batch: `id, total_urls, processed_urls, status`).
- The client subscribes to the public broadcast channel `batch:<uuid>`. Both tables are removed from the `supabase_realtime` publication.
- `/api/status/[batchId]` remains the first-paint snapshot.

### Abuse protection

- `check_requests(ip text, created_at timestamptz)` table; `/api/check` rejects with 429 after **10 requests per minute per IP**.
- IP taken from Netlify's `x-nf-client-connection-ip`, falling back to `getRequestIP(event, { xForwardedFor: true })`.
- pg_cron deletes rows older than 1 day.

### Migration of existing data

Order matters because `user_id` FKs are `on delete cascade`:

1. Add new columns/tables; backfill `domains` from `domain_summary` as `ok`.
2. Drop the "users read own …" policies, the `user_id` FKs, index and columns.
3. Delete the throwaway auth users (`email like '%@dr-checker.local'`).
4. Drop the `domain_summary` view; update the realtime publication; schedule the `check_requests` cleanup job.

`supabase/schema.sql` is updated to the end state for fresh installs; a migration in `supabase/migrations/` upgrades the live project.

## Consequences

- No more orphaned auth users; the upload flow no longer depends on Supabase Auth at all.
- Repeat lookups are instant and cost no Ahrefs calls; the directory grows as a side effect of every check.
- Submitted URLs (including CSV paths) are not enumerable through the anon key; only someone with a batch id can read or listen to that batch.
- Anyone can submit checks; the per-IP limit and input caps are the only abuse controls. A CAPTCHA (e.g. Turnstile) is the next step if abuse appears.
- The worker now has retry/backoff and stuck-row recovery, which the previous design claimed but did not implement.
- Users checking private/client domains publish them to the directory (stated in UI copy).
- Ahrefs' behavior for unknown domains is unverified; if it returns DR 0 rather than no DR, `no_data` will rarely occur.

## Alternatives rejected

- **Anon SELECT policies + `postgres_changes`:** simplest, but makes every submitted URL publicly enumerable via the anon key.
- **Polling `/api/status`:** no websocket dependency, but adds load and latency for the primary interaction.
- **Keeping throwaway accounts:** only existed to satisfy RLS for Realtime; adds latency and leaves dead users.
- **In-memory rate limiter:** ineffective on Netlify's serverless functions.
- **Registrable-domain normalization (public suffix list):** cleaner directory, but diverges from what users typed; deferred.
- **Always re-checking live / per-row refresh button:** wastes the Ahrefs rate limit for a slow-moving metric.
- **Per-IP hourly domain quota:** replaced by the lower 1,000-entry CSV cap.
