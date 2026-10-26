# App shell redesign: sidebar, Check / Domains / Docs

## Context

DR Checker is used by **SEO professionals who want to check their domains' DR**. Today a single home page (`pages/index.vue`) mixes three jobs: a large hero with the check form and its results, the full domain directory with an 8-field filter form underneath, and a top bar whose only link is "Docs". The next action isn't obvious.

The goal is a layout where each job has its own place and its own clear action:
- **Check:** submit domains and get results.
- **Domains:** browse, compare and export the directory.
- **Docs:** learn how it works.

A persistent left sidebar switches between them. All decisions below were confirmed with the user in a grilling session (Q1–Q20) unless marked *(builder's call)*.

**First steps on approval**
1. Create branch `feat/app-shell` from `main`. Ideally the `docs/claude-md-current-state` PR is merged first; it stays its own PR either way.
2. Save this design to `specs/2026-10-26-app-shell-redesign-design.md` (repo convention: plans in `specs/`, ADRs in `specs/adr/`) and commit it first.
3. Run `superpowers:writing-plans` to produce the step-by-step plan in `specs/`.

## Goals / non-goals / anti-goals

**Goals**
- A collapsible left sidebar: **Check** (`/`), **Domains** (`/domains`), **Docs** (`/docs`).
- A Domains data table for browse / compare / export: rich rows, sortable Δ, a persistent selection, and server-side export of the selection.
- A decluttered Check page with "My recent checks".

**Non-goals**
- No accounts or server-saved lists. Selection and recent checks are per browser.
- No changes to the worker, queue, cache or Realtime. Edge functions are untouched.
- No "Changed only" filter, and no export of everything that matches the filters (only the selection).
- No visual rebrand.

**Anti-goals (a failure even if it "works")**
- **Breaking SEO.** `/domain/<domain>` keeps its SSR, head tags, status codes (200/404/503/301) and `Cache-Control: public, s-maxage=600, stale-while-revalidate=3600`. `/sitemap.xml` and `/robots.txt` don't change.
- Hydration mismatches or a layout flash from the sidebar state.
- A Domains page slower than today, or N+1 queries.
- Horizontal scroll at 375px.

## Constraints
- Nuxt 3 + Tailwind, keeping the current look (Q2):
  - colors: `#f5f5f7` background, `#1d1d1f` text, accent `#0071e3` (`tailwind.config.ts`)
  - white rounded-2xl cards with `border-black/5`
  - a light sidebar
- Netlify serverless: no in-memory state. DB access only through `server/utils/supabaseAdmin.ts`.
- Gates: `npm test`, `npm run typecheck` (0 errors), `npm run build`.
- **This work includes a migration.** Follow the CLAUDE.md rules:
  - write a file in `supabase/migrations/`, mirror it into `supabase/schema.sql`, apply it with `npx -y supabase@2.109.0 db push`, then run `npm run gen:types` and commit the regenerated types;
  - the SQL scenario test (`supabase/tests/*.sql`, ending in `SCENARIO OK`) is run by the user.

## Decisions

### 1. Routes and shell (Q1, Q7, Q8)
- **Routes:** `/` = Check, `/domains` = directory (new), `/docs` unchanged. `/results/<id>` and `/domain/<domain>` render inside the shell.
- **Active entry:**
  - `/` and `/results/*` → Check
  - `/domains` and `/domain/*` → Domains
  - `/docs` → Docs
- **Files:** new `layouts/default.vue` + `components/AppSidebar.vue`. `app.vue` becomes `<NuxtLayout><NuxtPage/></NuxtLayout>`.
- **Expanded sidebar (~220px):** logo "DR Checker", then Check / Domains / Docs (inline-SVG icon + label), then a "« collapse" toggle and the "Developed with ❤️ by Brahim Anjjar" credit at the bottom.
- **Collapsed sidebar (~64px):** an icon rail with tooltips and `aria-label`s; the credit is hidden.
- **Top bar and footer:** removed.
- **Collapsed-state persistence** *(builder's call, forced by the CDN)*:
  - **Why not a cookie:** `/domain/*` is CDN-cached and Netlify doesn't vary its cache by cookie, so a cookie-rendered width would leak one visitor's choice to everyone.
  - **How it works:**
    - SSR always renders the same markup.
    - An inline critical `<head>` script reads `localStorage['dr-sidebar']` (in a try/catch) and sets `data-sidebar="collapsed"` on `<html>` before the first paint.
    - Width and label visibility are driven by CSS on that attribute, never by Vue-rendered classes.
    - The toggle updates both the attribute and `localStorage`.
  - Default is expanded.
- **Phone (< `md`):**
  - A slim top bar (logo + menu button) opens the sidebar as an overlay drawer.
  - The drawer has a focus trap and closes on Esc, on backdrop click and on route change.
- **Accessibility:** `<nav aria-label="Main">`, `aria-current="page"` on the active link, and visible focus rings.

### 2. Check page (`pages/index.vue`) (Q6)
- **Header:** the hero is replaced by a compact header, "Check Domain Rating" plus one help line linking to Docs. The form logic is unchanged.
- **Directory removed:** the directory section and its state move to `/domains`. After `@completed`, a "See all domains →" link appears.
- **My recent checks:**
  - **Storage:** `localStorage` key `dr-recent-checks`, holding `{ batchId, createdAt, total, label, inline }` per entry.
    - `label` is the first domain + "+N more", or the CSV filename.
    - Newest first, deduplicated, capped at 20. Every read and write is wrapped in try/catch.
  - **When it's written:** after a successful `POST /api/check`.
  - **Where it shows:** under the form, client-only.
  - **Links:** inline-sized checks go to `/?check=<id>`, everything else to `/results/<id>`.
  - **Live status:** none. A "Clear" link empties the list.
  - **Helpers:** the pure logic lives in `utils/recentChecks.ts`, with unit tests.

### 3. Domains page (`pages/domains.vue`) (Q4, Q16, Q18, Q19)

**Rendering (Q4)**
- Server-rendered with `useFetch('/api/domains', { query })` keyed on the route query, so crawlers get real links to `/domain/*`.
- `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.
- Skeleton rows show only on client refetches; the old rows stay dimmed until the new ones arrive.
- The selection UI is client-only.

**Toolbar**
- A debounced "Search domains…" box, inline DR min–max and TLD filters, and a "More filters" popover for the "Checked from/to" dates.
- Active filters show as removable chips plus "Clear all". The old 8-field form is removed.

**Columns**
- ☐ **Checkbox.**
- **Favicon + domain, with the title under it:**
  - favicon from `domain_meta`, with a letter avatar as fallback;
  - clicking a row opens `/domain/<d>`; the checkbox cell stops propagation.
- **DR:**
  - right-aligned, `tabular-nums`;
  - a small bar with 4 bands (Q18): 0–29 grey, 30–59 amber, 60–79 blue, 80–100 green;
  - the number is always shown, so color is never the only signal.
- **Δ (Q10):**
  - DR change since the previous reading, from the stored `domains.dr_change`;
  - "+3" green with an up icon, "−1" red with a down icon, "—" when null;
  - each value has an `aria-label`.
- **Trend:** a sparkline of the last 12 readings using `sparklinePath` (`utils/domainView.ts`). It's hidden when there are fewer than 2 readings.
- **Checked:** relative time from `checkedAgo`.

**Sorting and headers**
- Sort by clicking the **Domain, DR, Δ or Checked** header (Q12). An arrow shows the direction, and the header carries `aria-sort`.
- The default is Checked, descending. Δ sorts nulls last.
- The header row is sticky, and rows highlight on hover.

**Selection (Q16)**
- A header checkbox selects or deselects the visible page, with an indeterminate state.
- The selection is a `Set<domain>` (plus display data). It survives paging, filtering and reload (`sessionStorage`, try/catch) and is capped at 1,000, with a notice at the cap.
- A sticky bottom bar shows "N selected · Export selected · Clear selection".

**Pagination (Q19)**
- "1–20 of 1,284", page numbers with ellipsis, Prev/Next.
- Rows per page: 20/50/100, default 20.

**Other**
- **URL state:** search, filters, sort, page and pageSize all sync to the query string (`router.replace`), so views are shareable and back/forward works.
- **States:**
  - Empty, with no filters: "No domains checked yet".
  - Empty, with filters: "No domains match these filters · Clear filters".
  - Error: a message with Retry.
- **Phone:** rows render as cards with favicon, domain, title, DR, Δ, checked and the checkbox.
- **Head:** "Domain directory | DR Checker" plus a description. The page is indexable, with no sitemap change.

### 4. Database migration (Q3 = B, Q11, Q13, Q17)
One migration, mirrored into `schema.sql`.

**`dr_change`**
- Add `domains.dr_change numeric null` and `create index idx_domains_dr_change on public.domains (dr_change)`.
- **Trigger** `AFTER INSERT OR UPDATE ON domain_history FOR EACH ROW`:
  - it sets `domains.dr_change` to the latest reading minus the previous one for that domain, or null when there's only one reading;
  - it doesn't race the worker, because the worker's `domains` upsert never writes `dr_change`;
  - if the `domains` row doesn't exist yet (new domain), the update is a no-op, which is correct since Δ needs two readings.
- **Backfill:** the migration computes `dr_change` for all existing domains with a window function over `domain_history`.

**`domain_trends`**
- `domain_trends(p_domains text[], p_n int)` returns `(domain, dr, checked_at)`: the last `p_n` readings per domain, using a window function on the `(domain, checked_at)` unique index.
- Execute is revoked from `public, anon, authenticated`.

**Rate limiting (Q17)**
- Add `check_requests.kind text not null default 'check' check (kind in ('check','export'))`, and replace the index with `(ip, kind, created_at)`.
- `register_check_request(p_ip text, p_limit int default 10, p_kind text default 'check')` counts per `kind`. Existing callers are unchanged. Re-revoke execute for the new signature and drop the old one.

**SQL scenario test** (`supabase/tests/domains_ui.sql`, run by the user), covering:
- trigger Δ on a first, second and third reading;
- backfill correctness;
- `domain_trends` limits and ordering;
- separate rate-limit buckets.

### 5. API
**`GET /api/domains`** (`server/api/domains.get.ts`)
- Keep the current filters and validation. Add `pageSize` ∈ {20, 50, 100} (anything else → 400) and `sortBy=dr_change` (nulls last).
- Select `dr_change`. For the returned page, run one batched `domain_meta` `in (…)` query (reuse `metaViewFrom` for `favicon_url`) and one `domain_trends(domains, 12)` RPC call.
- **Row shape:** `{ domain, dr, checked_at, dr_change, title, favicon_url, trend: number[] }` (trend oldest → newest).
- Grouping the RPC rows into per-domain arrays is a pure function in `server/utils/domainTrends.ts`, with tests.

**`POST /api/domains/export`** (new) (Q5 = B, Q14, Q15)
- **Rate limit:** `register_check_request(ip, 10, 'export')` per IP (IP from `x-nf-client-connection-ip`). Over the limit → 429 + `Retry-After: 60`.
- **Body:** `{ domains: string[] }`. Each entry goes through `normalizeDomain`, then is deduplicated. An empty list, or more than 1,000 entries, → 400.
- **Query:** current values from `domains` (`status = 'ok'` only; others are skipped) joined in Nitro with `domain_meta` titles.
- **Response:** `text/csv` with `Content-Disposition: attachment; filename="dr-domains-YYYY-MM-DD.csv"`.
  - Columns: `domain, title, dr, dr_change, checked_at (ISO), page_url`.
  - `page_url` = `siteBase(SITE_URL) + domainPath(domain)`.
- **CSV building:** pure `server/utils/domainsCsv.ts`, with tests. It does RFC 4180 quoting and guards against formula injection by prefixing values that start with `= + - @` (and tab/CR) with `'`.
- **Client:** `fetch` → blob → download link. It shows a toast on a 429, telling the user to wait and try again.

### 6. Docs (`pages/docs.vue`) (Q20)
- The content stays. The "← Back to checker" link is removed.
- On `lg` screens, "On this page" becomes a sticky right-hand column with scroll-spy (IntersectionObserver highlights the current section). Smaller screens keep it inline.
- Section 7 "Domain directory" is rewritten for the Domains page: sorting, Δ, selection and export, and the export limits (1,000 per export, 10 exports/min).

### 7. Other pages
- `/results/[batchId]`: keeps "← New check".
- `/domain/[domain]`: no logic or header changes; it now renders in the shell.

## Left to the builder
- Spacing, icon artwork and transitions; component split (e.g. `AppSidebar`, `DomainsToolbar`, `DomainsTable`, `SelectionBar`, `DrBar`, `Sparkline`); debounce timing; skeleton count; toast implementation.

## Critical files
- **New:**
  - `layouts/default.vue`, `components/AppSidebar.vue`, `pages/domains.vue`
  - `server/api/domains/export.post.ts`
  - `server/utils/domainTrends.ts`, `server/utils/domainsCsv.ts`, `utils/recentChecks.ts`, plus their tests
  - `supabase/migrations/<ts>_domains_ui.sql`, `supabase/tests/domains_ui.sql`
- **Modified:**
  - `app.vue`, `pages/index.vue`, `pages/docs.vue`
  - `server/api/domains.get.ts`, `server/utils/rateLimit.ts` (pass `kind`)
  - `supabase/schema.sql`, `supabase/functions/_shared/database.types.ts` (regenerated)
- **Reused:**
  - `utils/domainView.ts` (`sparklinePath`, `metaViewFrom`, `siteBase`, `formatDr`), `utils/domainPath.ts`, `utils/checkedAgo.ts`
  - `server/utils/domain.ts` (`normalizeDomain`)
  - `components/CheckResults.vue`

## Verification
1. **Gates:** `npm test` (new tests: recentChecks, domainsCsv, domainTrends, pageSize/sortBy validation, export body validation), `npm run typecheck` (0 errors), `npm run build`.
2. **Database:**
   - `db push`, then `gen:types`.
   - The user runs the `supabase/tests/domains_ui.sql` scenario and expects `SCENARIO OK`.
   - Read-only Management API spot check: `select count(*) filter (where dr_change is not null) from domains`.
   - The CLAUDE.md health check returns no rows.
3. **Local** (`npm run dev`, Node 24):
   - **Sidebar:** collapse persists across reloads with no flash, and the active entry is right on all 5 route types.
   - **Phone:** the drawer works at 375px with no horizontal scroll.
   - **Domains selection and export:**
     - Select rows on page 1, change a filter, select on page 3, reload: the selection is kept.
     - Export, and check that the CSV columns and formula guard are right.
     - The 11th export within a minute → 429.
   - **Domains view:** sort by Δ, check that the URL state round-trips with back/forward, and check the empty/error/loading states.
   - **Check page:** a check shows up in recent checks; "See all domains" appears; the inline result renders for ≤ 10 domains.
4. **SEO regression:**
   - `curl -I` on a known `/domain/<d>` (200 + unchanged cache header), an unknown one (404 + noindex) and a non-canonical spelling (301).
   - `/sitemap.xml` and `/robots.txt` are unchanged.
   - `curl /domains` returns server-rendered rows.
5. **After merge:** repeat steps 3–4 on https://dr-bulkchecker.netlify.app.
