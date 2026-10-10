# ADR 0003: Domain pages, DR history and site metadata

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

The audit of 2026-10-10 (item A6) found that the `domains` table is only exposed as a paged list. No page shows a single domain, and DR history is not kept: each live check overwrites the previous value. The user also asked to show each domain's favicon, meta title and meta description.

Two goals follow:

1. **Search traffic.** Every checked domain should have a page that search engines can index.
2. **Richer pages.** Those pages should show the domain's DR history and the site's own identity: its favicon, title and description.

Fetching site metadata means our servers request arbitrary third-party URLs. That is the riskiest new code in this project, for three reasons:

- server-side request forgery against internal addresses;
- hostile or huge responses;
- slow sites.

It must not interfere with DR processing (ADR 0002).

## Decision

### Delivery

The decision ships as **two PRs**:

- **PR A: history, page and SEO.**
- **PR B: metadata.**

The domain page renders without metadata, so PR A is useful on its own.

### Data model

**`domain_history`** stores one row per real Ahrefs reading.

- Columns: `id bigint generated always as identity primary key`, `domain text not null`, `dr numeric not null`, `checked_at timestamptz not null`.
- Constraints: `unique (domain, checked_at)` and an index on `(domain, checked_at desc)`. RLS is on, with no policies.
- **Writer:** the `process-queue` worker. When a result is `ok`, the worker inserts a history row next to its existing `domains` upsert, with the same `checked_at`. `no_data` and transient results never write history.
- **Backfill:** insert the distinct `(domain, dr, checked_at)` from `urls` where `source = 'live'` and `dr is not null`, with `on conflict do nothing`. ADR 0001's migration labelled every older done row as `live`, so this covers all history.

**`domain_meta`** holds the latest metadata per domain.

- Columns: `domain text primary key`, `title text`, `description text`, `favicon_path text`, `status text check (status in ('ok','error'))`, `error text`, `fetched_at timestamptz`, `claimed_at timestamptz`, `attempts integer not null default 0`. RLS is on, with no policies.
- **A domain is due** when it has a `domains` row with `status = 'ok'` and any of these holds:
  - it has no `domain_meta` row;
  - its metadata is `ok` and was fetched more than **30 days** ago;
  - its metadata is `error` and was fetched more than **7 days** ago.
- **`claim_meta_domains(p_limit integer) returns setof text`** claims due domains, plus rows claimed more than **2 minutes** ago that never finished. It uses `FOR UPDATE SKIP LOCKED`, sets `claimed_at = now()` and increments `attempts`. It is server-only: execute is revoked from `public`/`anon`/`authenticated`.

**Storage:** a **public** bucket named `favicons`.

- Objects are stored as `<domain>.<ext>`.
- Only the `fetch-meta` function writes, using the service role.
- The public URL is `${SUPABASE_URL}/storage/v1/object/public/favicons/<favicon_path>`.

**Triggering:** `kick_meta_worker()` mirrors ADR 0002's `kick_worker()`.

- It is `security definer` with `search_path = ''`, and execute is revoked.
- It returns immediately unless some domain is due.
- It reads the existing Vault entry `worker_secret` and a new entry `meta_worker_url`. If either is missing it raises a warning and returns.
- It sends one `pg_net` POST with `x-worker-secret` and a 120 s timeout.
- A **pg_cron job runs it every minute**.
- `scripts/provision-worker-secret.sh` also sets `meta_worker_url`.

### The `fetch-meta` edge function

Its shape mirrors `process-queue`:

- **Auth:** `checkWorkerSecret` (shared `auth.ts`). A wrong or missing header gets 401; an unset `WORKER_SECRET` gets 500.
- **Per run:** claim up to **5** domains and process them one at a time.
- **Budget:** no new domain is started after **60 s**, and the next minute's tick continues.
- **No lease:** `SKIP LOCKED` already keeps runs from sharing a domain, and there is no provider rate limit to protect.

**Safe fetching (`safeFetch.ts`).** Every outbound request goes through this module.

- **Target:** only `https://<domain>/`. If the TLS connection or DNS lookup fails, it falls back once to `http://<domain>/`.
- **Ports:** 80 and 443 only. No credentials are ever sent.
- **Headers:**
  - `User-Agent: DRCheckerBot/1.0 (+https://dr-bulkchecker.netlify.app)`
  - `Accept: text/html,application/xhtml+xml`
- **Address check:** before every request and every redirect hop, the host is resolved with `Deno.resolveDns` (A and AAAA). The request is refused if **any** resolved address is in a blocked range:
  - private: 10/8, 172.16/12, 192.168/16, fc00::/7;
  - loopback: 127/8, ::1;
  - link-local: 169.254/16 (which includes the 169.254.169.254 metadata endpoint), fe80::/10;
  - CGNAT 100.64/10, 0/8, multicast 224/4 and ff00::/8, reserved 240/4 and 255.255.255.255;
  - the IPv4-mapped and IPv4-compatible forms of all the above;
  - literal IP hosts are checked the same way.
- **Redirects:** followed **manually**, at most **3 hops**. Each hop's URL is re-validated for scheme, port and address.
- **Limits:**
  - **8 s** timeout per request.
  - HTML is read as a stream and cut off at **512 KB**, or as soon as `</head>` appears.
  - The page's `content-type` must be `text/html` or `application/xhtml+xml`.

**Parsing (`parseHead.ts`).** A pure, dependency-free reader of the `<head>`, so Vitest can test it.

- **Title:** `<title>`, falling back to `og:title`.
- **Description:** `<meta name="description">`, falling back to `og:description`.
- **Favicon candidates:** `link rel` values `icon`, `shortcut icon` and `apple-touch-icon`. Order: png or svg icons first, then any other `icon`, then `apple-touch-icon`. Each link is resolved against the final URL after redirects. If there is no candidate, it falls back to `/favicon.ico`.
- **Cleanup:** decode HTML entities, collapse whitespace, cap the title at **200** characters and the description at **500**. Text is stored as plain text and never rendered as HTML.

**Favicon download.** It uses `safeFetch` with the same rules, plus:

- at most **100 KB**;
- `content-type` in an allowlist: `image/png`, `image/x-icon`, `image/vnd.microsoft.icon`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`;
- upload to `favicons/<domain>.<ext>` with `upsert: true` and the matching `contentType`.

A favicon failure doesn't fail the domain: its metadata is stored with `favicon_path = null`.

**Outcomes:**

- **Success:** `status = 'ok'`, title, description and `favicon_path` set, `error = null`, `fetched_at = now()`, `attempts = 0`.
- **Any failure** (DNS, blocked address, timeout, non-HTML, too large, HTTP status ≥ 400): `status = 'error'`, a short `error` text, `fetched_at = now()`. The 7-day rule then decides when it is tried again. Nothing retries in a tight loop.

### Pages, API and SEO

**`GET /api/domain/[domain]`**

- Normalizes the input with `normalizeDomain`.
- Returns `{ domain, dr, checked_at, history: [{ dr, checked_at }] (newest first, ≤ 100), meta: { title, description, favicon_url } | null }`.
- Returns **404** when there is no `domains` row with `status = 'ok'`.

**`/domain/[domain]`** is server-rendered.

- **Content:**
  - the favicon, served from our bucket;
  - the domain, and the current DR in large type;
  - "checked N days ago";
  - the site's title and description under "From the site:", when present;
  - a small inline SVG line chart of DR over time, plus a table of past checks;
  - a **Re-check** button that posts `/api/check` with the domain and shows `CheckResults` inline (rate limits and the cache apply as usual).
- **`useHead`:**
  - title: `<domain> Domain Rating (DR <n>) | DR Checker`;
  - a meta description built from the DR, the check date and the site description when present;
  - a canonical link to `https://dr-bulkchecker.netlify.app/domain/<domain>`;
  - Open Graph title and description.
- **Unknown or `no_data` domain:**
  - HTTP status **404**, via `setResponseStatus`;
  - `<meta name="robots" content="noindex">`;
  - the page reads "We haven't checked <domain> yet" with a **Check its DR now** button.
- **Non-canonical input** (for example `/domain/WWW.Example.com` or a full URL): **301** redirect to `/domain/<normalized>`. Input that can't be normalized returns 404.
- **Caching:** `Cache-Control: public, s-maxage=600, stale-while-revalidate=3600`, so Netlify's CDN absorbs crawler traffic.

**Links into the pages:** domain cells in the directory table and in the results table link to `/domain/<domain>`.

**`/sitemap.xml`**

- Lists `/`, `/docs`, and every `ok` domain with `lastmod = checked_at`.
- `Cache-Control: public, s-maxage=3600`.
- One file is enough until **50,000** URLs. Past that, it splits into a sitemap index.

**`/robots.txt`**

- `Allow: /`
- `Disallow: /api/`
- `Disallow: /results/`
- `Sitemap: https://dr-bulkchecker.netlify.app/sitemap.xml`

## Consequences

- Each checked domain becomes an indexable page. Thin pages for unknown domains are never indexed (404 + `noindex`).
- History grows by at most about one point per domain per 30 days, because of the cache. Older readings are kept indefinitely and do not depend on batch data.
- The DR pipeline is unaffected. Metadata fetching has its own function, its own cron and its own limits, and it never touches `urls`, the lease or the Ahrefs pacing.
- Our servers now make outbound requests to arbitrary sites. The `safeFetch` rules are the security boundary and are unit-tested. Remaining risk:
  - **DNS rebinding:** the address can change between our check and the connection. Re-checking on every redirect hop narrows the window, but `fetch` doesn't let us pin the resolved IP. This residual risk is accepted, because the function holds no secrets beyond the service key and reaches no internal network.
  - **Favicon bucket:** it is public, and SVGs in it are served from Supabase's domain, not ours. An `<img>` tag never runs scripts.
- The initial metadata backfill takes about **2 hours** for ~576 domains, at 5 per minute.
- Storage use is bounded at 100 KB × the number of domains, about 58 MB at today's size.

## Verification

**PR A**

- A known domain page returns 200 with the right `<title>`, canonical link and history.
- An unknown domain returns 404 with `noindex` and the button.
- A non-canonical URL returns a 301.
- The sitemap lists the `ok` domains and `robots.txt` is served.
- A live check adds a `domain_history` row.
- `npm test`, `npm run typecheck`, `deno check` and `npm run build` pass, and `gen:types` produces the new tables.

**PR B**

- An unauthenticated call to `fetch-meta` returns 401.
- The cron job is keyless and its runs succeed.
- `domain_meta` fills in over time.
- A domain page shows its favicon (served from our bucket) and its title.
- A target that resolves to a private address ends as `error` (blocked) without any request being sent; the unit tests cover the address ranges.

## Rollback

- **PR A:** drop the history write from the worker and redeploy it. The table and pages are harmless to leave in place.
- **PR B:** unschedule the `fetch-meta` cron job, or delete the `meta_worker_url` Vault entry so that `kick_meta_worker()` only warns. Pages fall back to the plain view.

## Alternatives rejected

- **Client-rendered detail view instead of SEO pages:** the user chose search traffic.
- **Deriving history from `urls`:** history would be coupled to per-batch records, and any pruning would erase it.
- **Fetching metadata inside the DR worker:** it would break ADR 0002's time-limit invariants, and slow sites would delay DR results.
- **Fetching metadata on first page render:** the first visitor, often a crawler, would wait on the fetch, and risky outbound fetches would run inside the web app.
- **Hotlinking favicons:** visitors' privacy would leak to third parties, and images would break or be blocked as mixed content.
- **A third-party favicon service:** it leaks page views to that service and adds a dependency.
- **Returning 200 with a placeholder for unknown domains:** the site would be penalized for thin content.
