# App Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single long home page with a collapsible-sidebar shell (Check / Domains / Docs). Add a server-rendered Domains data table with sortable Δ, trend sparklines, a persistent selection and server-side CSV export of the selection.

**Architecture:**
- **Database:** one migration adds a trigger-maintained `domains.dr_change`, a `domain_trends` RPC (lateral + `LIMIT` on the existing `(domain, checked_at)` index) and per-`kind` rate-limit buckets.
- **Server:** Nitro gets a richer `GET /api/domains` and a new `POST /api/domains/export`.
- **Client:** the UI is a new default layout plus a new `/domains` page. Pure logic lives in small tested modules under `utils/` and `server/utils/`, and Vue files stay thin.

**Tech Stack:** Nuxt 3, Vue 3 `<script setup>`, Tailwind 3, Supabase Postgres (supabase-js v2, service role), Vitest (node env, pure-function tests only).

**Spec:** `specs/2026-10-26-app-shell-redesign-design.md`. Read it first; this plan only adds the names, signatures and tests.

## Global Constraints

- **Node ≥ 22.** Prefix commands with `PATH=$HOME/.nvm/versions/node/v24.16.0/bin:$PATH`.
- **Gates for every task:** `npm test`, `npm run typecheck` (0 errors). Before the release task, also `npm run build`.
- **Keep the current look:** `#f5f5f7` background, `#1d1d1f` text, `accent` `#0071e3` (Tailwind `accent`, `accent-hover`, `accent-light`), white `rounded-2xl` cards with `border-black/5`, and a light sidebar. Add no icon library; icons are inline SVG.
- **No in-memory server state.** DB access only through `supabaseAdmin()` (`server/utils/supabaseAdmin.ts`).
- **Browser storage:** every `localStorage`/`sessionStorage` access is wrapped in try/catch, and the page renders correctly without storage.
- **SEO must not change:**
  - `/domain/<d>` keeps `Cache-Control: public, s-maxage=600, stale-while-revalidate=3600` and its 200/404/503/301 behaviour.
  - `/sitemap.xml` and `/robots.txt` are untouched.
- **Migration flow:**
  - file in `supabase/migrations/`, mirrored into `supabase/schema.sql`;
  - then `npx -y supabase@2.109.0 db push` (`SUPABASE_ACCESS_TOKEN` from `.env`);
  - then `npm run gen:types`, committing `supabase/functions/_shared/database.types.ts`;
  - the SQL scenario test is run **by the user** (give them a `! …` command).
- **Commits:** end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Export body with junk mixed in:** entries that are invalid, `www.` variants or duplicates of each other should be normalized and deduplicated, with invalid ones dropped and no 400. A 400 happens only when nothing valid is left, or when there are > 1,000 entries after deduplication. *(Task 4 test.)*
2. **Hand-edited `/domains` URL** (`pageSize=37`, `sortBy=foo`, `page=-2`, `drMin=abc`): the page coerces to defaults and never shows the user an API 400. *(Task 7 test on `parseDomainsRoute`.)*
3. **CSV cells with `,` `"` newlines, or a leading `=`/`+`/`-`/`@`/tab/CR in a site title:** properly quoted and formula-guarded. A negative `dr_change` (e.g. `-3`) is a number, not a formula, and must **not** be prefixed. *(Task 4 test.)*
4. **Corrupt or unavailable storage** (garbage JSON in `dr-recent-checks` or `dr-domains-selection`, or a `getItem` that throws): the result is an empty list or set, with no crash. *(Task 6 and Task 8 tests.)*
5. **A domain on the page with zero or one history readings:** `trend` is `[]` or `[x]`, so no sparkline, and Δ is `—`. Domains missing from the RPC result still get `trend: []`. *(Task 3 test.)*

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/20261026000000_domains_ui.sql` | `dr_change` column, index, trigger and backfill; `domain_trends`; `check_requests.kind` and the new `register_check_request` |
| `supabase/tests/domains_ui.sql` | rollback-only scenario for the above |
| `server/utils/rateLimit.ts` | `assertRateLimit(event, kind)` |
| `server/utils/domainsQuery.ts` | pure: validate the `GET /api/domains` query |
| `server/utils/domainTrends.ts` | pure: group RPC rows into per-domain arrays |
| `server/api/domains.get.ts` | page query + meta + trends |
| `server/utils/domainsCsv.ts` | pure: export body parsing + CSV building |
| `server/api/domains/export.post.ts` | export endpoint |
| `utils/navSection.ts` | pure: route path → active sidebar entry |
| `layouts/default.vue`, `components/AppSidebar.vue`, `app.vue` | the shell |
| `utils/recentChecks.ts` | pure: recent-checks list logic |
| `pages/index.vue` | decluttered Check page + recent checks |
| `utils/domainsTable.ts` | pure: `drBand`, `formatDelta`, `pageRange`, route ↔ state |
| `utils/domainSelection.ts` | pure: selection set logic + storage |
| `pages/domains.vue`, `components/domains/*.vue` | Domains page |
| `pages/docs.vue` | sticky TOC + scroll-spy, section 7 rewrite |

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20261026000000_domains_ui.sql`, `supabase/tests/domains_ui.sql`
- Modify: `supabase/schema.sql` (the `domains` and `check_requests` tables, the `register_check_request` function and its revoke lines, plus new objects next to `domain_history`), `supabase/functions/_shared/database.types.ts` (regenerated)

**Interfaces:**
- Produces:
  - column `public.domains.dr_change numeric null`
  - RPC `public.domain_trends(p_domains text[], p_n integer) returns table(domain text, dr numeric, checked_at timestamptz)`
  - RPC `public.register_check_request(p_ip text, p_limit integer default 10, p_kind text default 'check') returns boolean`
  - column `public.check_requests.kind text not null default 'check'` with `check (kind in ('check','export'))`

- [ ] **Step 1: Write the scenario test `supabase/tests/domains_ui.sql`** in the style of `supabase/tests/meta_claim_cap.sql`: one `do $$ … $$` block ending in `raise exception 'SCENARIO OK'`. Use domains ending in `.test`. Assertions:
  - Insert `domains('dui-a.test', status 'ok', dr 40)`, then `domain_history('dui-a.test', 40, now()-2d)`. `dr_change` is null.
  - Insert history `(45, now()-1d)`. `dr_change = 5`.
  - Insert history `(42, now())`. `dr_change = -3`.
  - Insert a history row for `dui-orphan.test` with no `domains` row. This must not error.
  - Insert 15 history rows for `dui-b.test`. Then `select count(*) from domain_trends(array['dui-a.test','dui-b.test','dui-none.test'], 12)` = 3 + 12. The `dui-a.test` rows ordered `checked_at desc` give `42, 45, 40`.
  - `register_check_request('198.51.100.9', 2, 'check')` twice returns true, a third time false. `register_check_request('198.51.100.9', 2, 'export')` still returns true.
  - Backfill: run the same `update` the migration uses for the backfill (copy it into the test) on `dui-a.test` after setting `dr_change = null`. It comes back to `-3`.

- [ ] **Step 2: Write the migration.** Its contents:
  - `alter table public.domains add column if not exists dr_change numeric;` plus `create index if not exists idx_domains_dr_change on public.domains (dr_change);`
  - **Trigger function `public.refresh_dr_change()`** (`returns trigger`, `language plpgsql`, `set search_path = public`), fired by `after insert or update on public.domain_history for each row`. Body:
    ```sql
    update public.domains d
    set dr_change = (
      select (array_agg(t.dr order by t.checked_at desc))[1] - (array_agg(t.dr order by t.checked_at desc))[2]
      from (select dr, checked_at from public.domain_history
            where domain = new.domain order by checked_at desc limit 2) t
    )
    where d.domain = new.domain;
    return null;
    ```
  - **Backfill:**
    ```sql
    update public.domains d set dr_change = s.change
    from (select domain,
                 dr - lead(dr) over w as change,
                 row_number() over w as rn
          from public.domain_history
          window w as (partition by domain order by checked_at desc)) s
    where s.domain = d.domain and s.rn = 1;
    ```
  - **`domain_trends`:** `language sql stable`, body `select q.domain, h.dr, h.checked_at from unnest(p_domains) as q(domain) cross join lateral (select dr, checked_at from public.domain_history where domain = q.domain order by checked_at desc limit p_n) h;`
  - **Rate limiting:**
    - `alter table public.check_requests add column if not exists kind text not null default 'check' check (kind in ('check','export'));`
    - drop `idx_check_requests_ip_created` and create `idx_check_requests_ip_kind_created on (ip, kind, created_at)`.
    - `drop function public.register_check_request(text, integer);`
    - create the 3-argument version: the same body, but it filters and inserts `kind = p_kind` and takes its advisory lock on `hashtext(p_ip || ':' || p_kind)`.
    - Old Nitro code calls it with named args `p_ip`, `p_limit`, so it keeps working during the deploy window.
  - **Revokes:** `revoke execute … from public, anon, authenticated` for `domain_trends(text[], integer)` and `register_check_request(text, integer, text)`.

- [ ] **Step 3: Mirror it into `supabase/schema.sql`** as end state: add the column and index to the tables, add the function, trigger and RPC after `domain_history`, replace the old `register_check_request` and its revoke line. No backfill in `schema.sql` (fresh installs have no history).

- [ ] **Step 4: Apply and regenerate.**
  Run: `export $(grep -E '^SUPABASE_ACCESS_TOKEN=' .env) && npx -y supabase@2.109.0 db push && npm run gen:types`
  Expected: the migration applies. `git diff supabase/functions/_shared/database.types.ts` shows `dr_change`, `kind`, `domain_trends`, and `p_kind` on `register_check_request`.

- [ ] **Step 5: Ask the user to run the scenario** the way they run the other `supabase/tests/*.sql` files (paste it into the Supabase SQL editor). Expected: the error text `SCENARIO OK`; anything else names the failed assertion. Then run a read-only spot check through the Management API (`"read_only": true`): `select count(*) filter (where dr_change is not null) as with_delta, count(*) from public.domains where status='ok'`. Report the numbers.

- [ ] **Step 6: Run the gates and commit.** `npm test && npm run typecheck` (0 errors), then `git add supabase/ && git commit -m "feat(db): dr_change trigger + backfill, domain_trends RPC, per-kind rate limits"`.

---

### Task 2: Rate limiter takes a kind

**Files:**
- Modify: `server/utils/rateLimit.ts`, `tests/rateLimit.test.ts`

**Interfaces:**
- Consumes: the 3-arg `register_check_request` (Task 1)
- Produces: `export type RateLimitKind = "check" | "export"`; `assertRateLimit(event: H3Event, kind: RateLimitKind = "check"): Promise<void>`. The 429 message is `"Too many checks — try again in a minute"` for `check` and `"Too many exports — try again in a minute"` for `export`.

- [ ] **Step 1: Write the failing tests.** Change the mock to capture args: `rpc: async (_fn, args) => { lastArgs = args; return { data: allowed, error: null }; }`. Add:
  - `it("sends p_kind 'check' by default")`: `expect(lastArgs).toEqual({ p_ip: "203.0.113.7", p_limit: 10, p_kind: "check" })`.
  - `it("uses the export bucket and message")`: `allowed = false; await expect(assertRateLimit(event, "export")).rejects.toMatchObject({ statusCode: 429, message: "Too many exports — try again in a minute" }); expect(lastArgs.p_kind).toBe("export")`.
- [ ] **Step 2:** `npx vitest run tests/rateLimit.test.ts`. Expected: FAIL on `p_kind`.
- [ ] **Step 3:** Implement the signature above. `check.post.ts` keeps calling `assertRateLimit(event)`.
- [ ] **Step 4:** `npx vitest run tests/rateLimit.test.ts`. Expected: PASS. Then `npm run typecheck`.
- [ ] **Step 5:** Commit: `feat(api): rate limit buckets per kind`.

---

### Task 3: Richer `GET /api/domains`

**Files:**
- Create: `server/utils/domainsQuery.ts`, `server/utils/domainTrends.ts`, `tests/domainsQuery.test.ts`, `tests/domainTrends.test.ts`
- Modify: `server/api/domains.get.ts` (move the parsing out into `domainsQuery.ts`; keep `escapeLike` and the filter application in the handler)

**Interfaces:**
- Produces, in `server/utils/domainsQuery.ts`:
  ```ts
  export const PAGE_SIZES = [20, 50, 100] as const;
  export type SortBy = "checked_at" | "domain" | "dr" | "dr_change";
  export interface DomainsQuery {
    page: number; pageSize: 20 | 50 | 100; sortBy: SortBy; sortDir: "asc" | "desc";
    domain: string; tld: string; drMin: number | null; drMax: number | null;
    checkedFrom: string | null; checkedTo: string | null;
  }
  export class DomainsQueryError extends Error {}
  export function parseDomainsQuery(q: Record<string, unknown>): DomainsQuery; // throws DomainsQueryError
  ```
- Produces, in `server/utils/domainTrends.ts`:
  `export function groupTrends(domains: string[], rows: { domain: string; dr: number; checked_at: string }[]): Record<string, number[]>`. It returns, for each input domain, its DRs **oldest → newest**, and `[]` when there are none.
- Produces the response type, exported from `server/utils/domainsQuery.ts`:
  ```ts
  export interface DomainListRow {
    domain: string; dr: number | null; checked_at: string; dr_change: number | null;
    title: string | null; favicon_url: string | null; trend: number[];
  }
  export interface DomainsResponse { domains: DomainListRow[]; page: number; pageSize: number; total: number; totalPages: number; }
  ```

- [ ] **Step 1: Write the failing tests.**
  - `domainsQuery.test.ts`:
    - defaults: `parseDomainsQuery({})` → `{ page: 1, pageSize: 20, sortBy: "checked_at", sortDir: "desc", domain: "", tld: "", drMin: null, drMax: null, checkedFrom: null, checkedTo: null }`
    - `pageSize: "50"` → 50
    - `pageSize: "37"` throws `DomainsQueryError`
    - `sortBy: "dr_change"` is accepted
    - `sortBy: "foo"` throws
    - `tld: ".CO.uk"` → `"co.uk"`
    - `checkedFrom: "2026-13-40"` → null
    - `page: "-3"` → 1
  - `domainTrends.test.ts`:
    - rows given newest-first `[{a,42,t3},{a,45,t2},{a,40,t1},{b,10,t1}]` with domains `["a","b","c"]` → `{ a: [40,45,42], b: [10], c: [] }`
    - a numeric string such as `"42"` from PostgREST coerces to `42`
- [ ] **Step 2:** `npx vitest run tests/domainsQuery.test.ts tests/domainTrends.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement both modules. Move the current `parseNumber`/`parseDate`/sort validation into `parseDomainsQuery`, keeping its messages (`Invalid sortBy: …`, `Invalid sortDir: …`) and adding `Invalid pageSize: …`.
- [ ] **Step 4: Update the handler.**
  - `DomainsQueryError` → 400.
  - Select `domain, dr, checked_at, dr_change`, range by `pageSize`.
  - Order with `nullsFirst: false` for both `dr` and `dr_change`.
  - Then, only if the page is non-empty, run these in parallel:
    - `admin.from("domain_meta").select("domain, title, description, favicon_path, status").in("domain", pageDomains)`, mapping each through `metaViewFrom(row, supabaseUrl)` (`utils/domainView.ts`) for `title` and `favicon_url`;
    - `admin.rpc("domain_trends", { p_domains: pageDomains, p_n: 12 })`, passed through `groupTrends`.
  - A meta or trends error logs with `console.error("domains api: …")` and returns 500, the same as the main query.
  - Return `DomainsResponse`. Update the file's header comment, which now mentions `/domains` rather than the home page.
- [ ] **Step 5:** `npm test && npm run typecheck`. Expected: PASS and 0 errors. Then smoke-test: `npm run dev`, `curl -s 'localhost:3000/api/domains?pageSize=50&sortBy=dr_change' | head -c 600` shows `dr_change`, `title`, `favicon_url` and `trend`; `curl -s -o /dev/null -w '%{http_code}' 'localhost:3000/api/domains?pageSize=7'` prints `400`.
- [ ] **Step 6:** Commit: `feat(api): domains list with page size, Δ sort, meta and trends`.

---

### Task 4: Export endpoint

**Files:**
- Create: `server/utils/domainsCsv.ts`, `server/api/domains/export.post.ts`, `tests/domainsCsv.test.ts`

**Interfaces:**
- Consumes: `assertRateLimit(event, "export")` (Task 2), `normalizeDomain` (`server/utils/domain.ts`), `metaViewFrom`, `siteBase` (`utils/domainView.ts`), `domainPath` (`utils/domainPath.ts`)
- Produces, in `server/utils/domainsCsv.ts`:
  ```ts
  export const EXPORT_MAX = 1000;
  export class ExportInputError extends Error {}
  export function parseExportBody(body: unknown): string[];            // normalized, deduped, invalid dropped; throws ExportInputError
  export interface ExportRow { domain: string; title: string | null; dr: number; dr_change: number | null; checked_at: string; page_url: string; }
  export function csvCell(v: string | number | null): string;            // RFC 4180 + formula guard (strings only)
  export function buildDomainsCsv(rows: ExportRow[]): string;            // header + rows, "\r\n" line ends
  export function exportFilename(now: Date): string;                     // "dr-domains-YYYY-MM-DD.csv" (UTC)
  ```

- [ ] **Step 1: Write the failing tests** in `tests/domainsCsv.test.ts`.
  - `parseExportBody`:
    - `{ domains: ["www.A.com", "a.com", "https://b.org/x", "nodot", 5] }` → `["a.com", "b.org"]`
    - `{ domains: ["nodot"] }` throws `"No valid domains to export"`
    - `{}` throws `"Expected JSON { domains: string[] }"`
    - 1,001 distinct valid domains throw `"At most 1000 domains per export"`
    - 1,001 entries that dedupe to 1,000 are accepted
  - `csvCell`:
    - `'Acme, "Best" Co'` → `"\"Acme, \"\"Best\"\" Co\""`
    - `"=HYPERLINK(1)"` → `"'=HYPERLINK(1)"`
    - `"+1"`, `"@x"` and `"\tx"` all get a leading `'`
    - `-3` (a number) → `"-3"`
    - `null` → `""`
    - `"line1\nline2"` is quoted
  - `buildDomainsCsv`: the first line is exactly `domain,title,dr,dr_change,checked_at,page_url`, and the rows join with `\r\n`.
  - `exportFilename(new Date("2026-10-26T23:30:00Z"))` → `"dr-domains-2026-10-26.csv"`.
- [ ] **Step 2:** `npx vitest run tests/domainsCsv.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `domainsCsv.ts`.
- [ ] **Step 4: Implement `export.post.ts`.**
  - **Order:** `parseExportBody(await readBody(event))`, where `ExportInputError` → 400; then `await assertRateLimit(event, "export")`; then the queries.
  - **Queries:** in **chunks of 200 domains**, so `in.(…)` stays under PostgREST URL limits:
    - `domains` `.select("domain, dr, checked_at, dr_change").eq("status", "ok").in("domain", chunk)`
    - `domain_meta` `.select("domain, title, description, favicon_path, status").in("domain", chunk)`
  - **Rows:**
    - keep the order of the request list, skipping domains with no `ok` row or a null `dr`;
    - `checked_at` as an ISO string;
    - `page_url` = `siteBase(useRuntimeConfig().public.siteUrl) + domainPath(domain)`.
  - **Response:** set `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="<exportFilename(new Date())>"`, plus `Cache-Control: no-store`, and return `buildDomainsCsv(rows)`.
  - A DB error logs and returns 500.
- [ ] **Step 5:** `npm test && npm run typecheck`. Then with `npm run dev`:
  - `curl -s -X POST localhost:3000/api/domains/export -H 'content-type: application/json' -d '{"domains":["<a real domain from the directory>","nodot"]}'` prints the header plus one row.
  - Running it 11× in a loop makes the 11th call print `429`.
- [ ] **Step 6:** Commit: `feat(api): export selected domains as CSV`.

---

### Task 5: App shell (layout + sidebar)

**Files:**
- Create: `utils/navSection.ts`, `tests/navSection.test.ts`, `layouts/default.vue`, `components/AppSidebar.vue`
- Modify: `app.vue`

**Interfaces:**
- Produces:
  - `export type NavSection = "check" | "domains" | "docs"`
  - `export function navSection(path: string): NavSection | null`
  - `export const SIDEBAR_KEY = "dr-sidebar"` (value `"collapsed"` | absent)
  - the `<html data-sidebar="collapsed">` attribute contract

- [ ] **Step 1: Write the failing test.**
  - `"/"` → `check`; `"/?check=x"` handling is the caller's job, so pass `route.path`
  - `"/results/abc"` → `check`
  - `"/domains"` → `domains`
  - `"/domain/a.com"` → `domains`
  - `"/docs"` → `docs`
  - `"/elsewhere"` → `null`
  - `"/domainsx"` → `null`
- [ ] **Step 2:** `npx vitest run tests/navSection.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `navSection`.
- [ ] **Step 4:** `npx vitest run tests/navSection.test.ts`. Expected: PASS.
- [ ] **Step 5: Build the shell.**
  - **`app.vue`:** `<NuxtLayout><NuxtPage /></NuxtLayout>`, keeping the `min-h-screen bg-[#f5f5f7] text-[#1d1d1f] antialiased` wrapper. Remove the old header and footer.
  - **`layouts/default.vue`, head script:** use `useHead` to add a script with `tagPriority: "critical"` and `textContent: "try{if(localStorage.getItem('dr-sidebar')==='collapsed')document.documentElement.dataset.sidebar='collapsed'}catch(e){}"`.
  - **`layouts/default.vue`, layout:**
    - `md+`: the sidebar plus `<main>` side by side.
    - `< md`: a slim top bar (logo + menu button, `aria-expanded`, `aria-controls`) and an overlay drawer with the same `AppSidebar`. The drawer has a backdrop, closes on Esc and on backdrop click, closes on `route.fullPath` change, and traps focus while open. Return focus to the menu button on close.
  - **`components/AppSidebar.vue`:**
    - `<nav aria-label="Main">` with three `NuxtLink`s (Check `/`, Domains `/domains`, Docs `/docs`), each with an inline SVG icon and a `.sidebar-label` span.
    - The active one comes from `navSection(route.path)` and gets `aria-current="page"` plus accent styling.
    - A collapse toggle button (`aria-label` "Collapse sidebar"/"Expand sidebar") flips `document.documentElement.dataset.sidebar` and writes or removes `localStorage['dr-sidebar']` in a try/catch.
    - The credit link `https://github.com/braanj` "Developed with ❤️ by Brahim Anjjar" sits at the bottom.
    - **Width and label visibility come only from CSS on the attribute,** e.g. Tailwind `w-56 [html[data-sidebar=collapsed]_&]:w-16` and `[html[data-sidebar=collapsed]_&]:hidden` on labels and the credit. No reactive class depends on the stored state, so SSR and the client match.
    - In collapsed mode each link has `title` and `aria-label`.
    - Inside the mobile drawer the sidebar is always expanded: pass a `drawer` prop that disables the collapse toggle and the attribute styles.
  - **Results page:** `pages/results/[batchId].vue` keeps "← New check".
- [ ] **Step 6:** `npm test && npm run typecheck`. Then check by hand in `npm run dev`:
  - collapse, then reload: no flash of the wide sidebar, and no hydration warning in the console;
  - the active entry is right on `/`, `/results/<id>`, `/domains` (404 is fine until Task 7), `/domain/<d>` and `/docs`;
  - at 375px the drawer opens and closes with Esc, backdrop click and link click, with no horizontal scroll;
  - `curl -sI localhost:3000/domain/<d>` still shows the same `cache-control`.
- [ ] **Step 7:** Commit: `feat(ui): collapsible sidebar app shell`.

---

### Task 6: Check page declutter + My recent checks

**Files:**
- Create: `utils/recentChecks.ts`, `tests/recentChecks.test.ts`
- Modify: `pages/index.vue` (delete the whole "Domain directory" template block and its script section, lines ~52–163 and 228–330 today)

**Interfaces:**
- Consumes: `CheckResponse` (`server/utils/createCheck.ts`: `batchId`, `total`, `display`)
- Produces:
  ```ts
  export const RECENT_KEY = "dr-recent-checks";
  export const RECENT_MAX = 20;
  export interface RecentCheck { batchId: string; createdAt: string; total: number; label: string; inline: boolean; }
  type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
  export function readRecent(storage: StorageLike | null): RecentCheck[];
  export function writeRecent(storage: StorageLike | null, list: RecentCheck[]): void;   // swallows errors
  export function addRecent(list: RecentCheck[], entry: RecentCheck): RecentCheck[];     // newest first, dedupe by batchId, cap 20
  export function recentLabel(input: { csvName?: string; typed?: string; total: number }): string;
  export function recentHref(entry: RecentCheck): string;                                // inline ? `/?check=${id}` : `/results/${id}`
  ```

- [ ] **Step 1: Write the failing tests.**
  - `readRecent`:
    - `null` storage → `[]`
    - `getItem` throws → `[]`
    - `"not json"` → `[]`
    - JSON containing one valid entry and one `{foo:1}` → just the valid entry
  - `addRecent`:
    - re-adding an existing `batchId` moves it to the front without duplicating it
    - 21 entries → 20, and the oldest is dropped
  - `recentLabel`:
    - `{ typed: " a.com, b.org\nc.net", total: 3 }` → `"a.com +2 more"`
    - `{ typed: "a.com", total: 1 }` → `"a.com"`
    - `{ csvName: "list.csv", total: 500 }` → `"list.csv"`
  - `recentHref` returns the two shapes above.
  - `writeRecent` with a throwing `setItem` doesn't throw.
- [ ] **Step 2:** `npx vitest run tests/recentChecks.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `recentChecks.ts`.
- [ ] **Step 4:** `npx vitest run tests/recentChecks.test.ts`. Expected: PASS.
- [ ] **Step 5: Update `pages/index.vue`.**
  - **Header:** replace the hero `<section>` with a compact header. `<h1>` "Check Domain Rating" (`text-3xl`), then one line: "Type up to 100 domains or upload a CSV of up to 1,000. <NuxtLink to="/docs">How it works</NuxtLink>". Keep the form exactly as it is.
  - **After a successful `$fetch`:** call `addRecent`/`writeRecent` with `{ batchId: res.batchId, createdAt: new Date().toISOString(), total: res.total, label: recentLabel(mode === "csv" ? { csvName: file.name, total } : { typed: domainsText, total }), inline: res.display === "inline" }`. Do this before navigating.
  - **Recent checks section:** under the form, wrapped in `<ClientOnly>`, read on mount.
    - Heading "My recent checks", plus a "Clear" text button that writes `[]`.
    - The list shows `label`, `total` ("N domains") and `checkedAgo(createdAt)`, each linking to `recentHref`.
    - Hide the whole section when the list is empty.
  - **"See all domains →":** a `NuxtLink` to `/domains` that appears once `CheckResults` emits `completed`. Keep `@completed` but point it at a `completed` ref; the old `loadDomains` call goes away.
  - Add `useHead({ title: "DR Checker: bulk Ahrefs Domain Rating checker" })` if none is set today.
- [ ] **Step 6:** `npm test && npm run typecheck`. By hand: run a 2-domain check. The inline result renders, the entry appears in recent checks after a reload, "See all domains" appears on completion, and Clear empties the list.
- [ ] **Step 7:** Commit: `feat(ui): decluttered check page with recent checks`.

---

### Task 7: Domains page (table, toolbar, URL state, pagination)

**Files:**
- Create: `utils/domainsTable.ts`, `tests/domainsTable.test.ts`, `pages/domains.vue`, `components/domains/DomainsToolbar.vue`, `components/domains/DomainsTable.vue`, `components/domains/DrBar.vue`, `components/domains/TrendSpark.vue`, `components/domains/Pager.vue`
- Modify: none

**Interfaces:**
- Consumes: `DomainsResponse`, `DomainListRow`, `SortBy` (Task 3; import types from `~/server/utils/domainsQuery`), `sparklinePath`, `formatDr` (`utils/domainView.ts`), `checkedAgo` (`utils/checkedAgo.ts`), `domainPath`
- Produces, in `utils/domainsTable.ts`:
  ```ts
  export type DrBand = "low" | "mid" | "high" | "top";           // 0–29 | 30–59 | 60–79 | 80–100
  export function drBand(dr: number): DrBand;
  export function formatDelta(change: number | null): { text: string; dir: "up" | "down" | "flat" | "none"; label: string };
  export function pageRange(current: number, total: number): (number | "…")[];
  export interface DomainsState {
    page: number; pageSize: 20 | 50 | 100; sortBy: SortBy; sortDir: "asc" | "desc";
    domain: string; tld: string; drMin: string; drMax: string; checkedFrom: string; checkedTo: string;
  }
  export const DEFAULT_STATE: DomainsState;
  export function parseDomainsRoute(q: Record<string, unknown>): DomainsState; // never throws; invalid → default
  export function toRouteQuery(s: DomainsState): Record<string, string>;        // omits defaults/empties
  export function nextSort(s: DomainsState, col: SortBy): Pick<DomainsState, "sortBy" | "sortDir" | "page">;
  ```

- [ ] **Step 1: Write the failing tests** in `tests/domainsTable.test.ts`.
  - `drBand`: 29.9 → `low`, 30 → `mid`, 59 → `mid`, 60 → `high`, 80 → `top`, 100 → `top`.
  - `formatDelta`:
    - `3` → `{ text: "+3", dir: "up", label: "Up 3 since previous check" }`
    - `-1.4` → `{ text: "−1", dir: "down", label: "Down 1 since previous check" }` (U+2212 minus)
    - `0.2` → `{ text: "0", dir: "flat", label: "No change since previous check" }`
    - `null` → `{ text: "—", dir: "none", label: "No previous check" }`
  - `pageRange`:
    - `(1,1)` → `[1]`
    - `(1,5)` → `[1,2,3,4,5]`
    - `(1,65)` → `[1,2,3,"…",65]`
    - `(33,65)` → `[1,"…",32,33,34,"…",65]`
    - `(65,65)` → `[1,"…",63,64,65]`
  - `parseDomainsRoute`:
    - `{}` → `DEFAULT_STATE`
    - `{ pageSize: "37", sortBy: "foo", sortDir: "up", page: "-2", drMin: "abc" }` → `DEFAULT_STATE` (Review Focus 2)
    - `{ pageSize: "100", sortBy: "dr_change", sortDir: "asc", page: "3", tld: "io" }` round-trips through `toRouteQuery` to `{ pageSize: "100", sortBy: "dr_change", sortDir: "asc", page: "3", tld: "io" }`
  - `toRouteQuery(DEFAULT_STATE)` → `{}`.
  - `nextSort`:
    - clicking the current column flips the direction
    - clicking a new column → `desc` for `dr`/`dr_change`/`checked_at`, `asc` for `domain`
    - the page always resets to 1
- [ ] **Step 2:** `npx vitest run tests/domainsTable.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `domainsTable.ts`. `DEFAULT_STATE` is `{ page: 1, pageSize: 20, sortBy: "checked_at", sortDir: "desc" }` with all filters `""`.
- [ ] **Step 4:** `npx vitest run tests/domainsTable.test.ts`. Expected: PASS.
- [ ] **Step 5: Build `pages/domains.vue`.**
  - **Data:**
    - `const state = computed(() => parseDomainsRoute(route.query))`;
    - `const { data, pending, error, refresh } = await useFetch<DomainsResponse>("/api/domains", { query: computed(() => toRouteQuery(state.value)) })`;
    - every control updates the URL via `router.replace({ query: toRouteQuery({ ...state.value, ...patch, page: patch.page ?? 1 }) })`.
  - **SSR cache:** `if (import.meta.server) useResponseHeader("Cache-Control").value = "public, s-maxage=60, stale-while-revalidate=300"`.
  - **Head:** `useHead({ title: "Domain directory | DR Checker", meta: [{ name: "description", content: "Every domain checked with DR Checker: latest Ahrefs Domain Rating, change since the previous check and trend." }] })`.
  - **Header:** `<h1>` "Domains" plus the total count.
  - **`DomainsToolbar`:**
    - a search input, debounced 350 ms, with `aria-label` "Search domains";
    - DR min/max number inputs (0–100) and a TLD input, debounced as well;
    - a "More filters" disclosure (`<details>` is fine) with the two date inputs;
    - chips for each active filter (`domain: x ✕`, `DR 30–60 ✕`, `.io ✕`, dates), each removing its filter, plus "Clear all".
  - **`DomainsTable`:**
    - **Header:** a sticky `<thead>` (`sticky top-0 bg-white`).
    - **Sortable headers:** Domain, DR, Δ and Checked are `<button>`s inside `<th aria-sort>`, using `nextSort` and showing an arrow. Trend is not sortable.
    - **Checkbox column:** a slot for Task 8, rendered as an empty cell for now.
    - **Row:**
      - favicon `<img width=20 height=20 loading=lazy alt="">`, falling back to a letter avatar (first letter, `bg-black/5`), then the domain `NuxtLink` to `domainPath`, with the title (`truncate`, `title` attr) under it;
      - DR: right-aligned `tabular-nums` `formatDr`, plus `<DrBar :dr>` coloured by `drBand`: `bg-black/20`, `bg-amber-400`, `bg-accent`, `bg-emerald-500`; width `dr%`;
      - Δ: `formatDelta`, coloured `text-emerald-600`/`text-red-600`/`text-[#6e6e73]`, with `aria-label`;
      - `<TrendSpark :values="row.trend">`: an 80×24 SVG using `sparklinePath`, rendering nothing when there are fewer than 2 values;
      - Checked: `checkedAgo`.
    - **Behaviour:** clicking a row navigates to `domainPath`; clicks inside the checkbox cell `stopPropagation`. Rows highlight on hover.
    - **Phone (< md):** render a card list instead of the table (domain/title, DR + Δ, checked).
  - **States:**
    - Refetch: while `pending` and data already exists, dim the table (`opacity-50`).
    - First client load with no data: 8 skeleton rows.
    - `error`: "Couldn't load domains." plus a Retry button that calls `refresh()`.
    - Empty: "No domains checked yet." when no filters are active; otherwise "No domains match these filters." plus a "Clear filters" button.
  - **`Pager`:** "{from}–{to} of {total}", `pageRange` buttons (current one `aria-current="page"`), Prev/Next, and a rows-per-page `<select>` (20/50/100).
- [ ] **Step 6:** `npm test && npm run typecheck`. Checks:
  - `curl -s localhost:3000/domains | grep -c 'href="/domain/'` is ≥ 1, so the page is server-rendered.
  - `curl -sI localhost:3000/domains | grep -i cache-control` shows `s-maxage=60`.
  - By hand: sort every column, check that filters and chips update the URL and back/forward restores the view, try 20/50/100 rows, a hand-edited bad URL shows the defaults, and the 375px card layout has no horizontal scroll.
- [ ] **Step 7:** Commit: `feat(ui): domains directory page with rich, sortable table`.

---

### Task 8: Selection + Export selected

**Files:**
- Create: `utils/domainSelection.ts`, `tests/domainSelection.test.ts`, `components/domains/SelectionBar.vue`
- Modify: `components/domains/DomainsTable.vue` (fill in the checkbox slot), `pages/domains.vue`

**Interfaces:**
- Consumes: `POST /api/domains/export` (Task 4), `EXPORT_MAX` (import from `~/server/utils/domainsCsv`)
- Produces:
  ```ts
  export const SELECTION_KEY = "dr-domains-selection";   // sessionStorage
  export function loadSelection(storage: Pick<Storage, "getItem"> | null): Set<string>;
  export function saveSelection(storage: Pick<Storage, "setItem"> | null, sel: Set<string>): void; // swallows errors
  export function toggleDomain(sel: Set<string>, domain: string): { sel: Set<string>; capped: boolean };
  export function setPage(sel: Set<string>, pageDomains: string[], on: boolean): { sel: Set<string>; capped: boolean };
  export function pageCheckState(sel: Set<string>, pageDomains: string[]): "none" | "some" | "all";
  ```
  The functions return new Sets and never mutate their input. The cap is `EXPORT_MAX` (1000): adding beyond it adds nothing more and returns `capped: true`.

- [ ] **Step 1: Write the failing tests.**
  - `loadSelection`:
    - `null` → empty
    - a throwing `getItem` → empty
    - `"{bad"` → empty
    - `'["a.com",5,"b.org"]'` → `{"a.com","b.org"}`
    - a stored array of 1,500 → the first 1,000
  - `toggleDomain`: adds, then removes; at 1,000 entries adding a new one returns `capped: true` and size 1000, while removing at the cap still works.
  - `setPage`: `on` adds every page domain up to the cap; `off` removes only the page domains and keeps the others.
  - `pageCheckState`: `none`, `some` and `all`; an empty page gives `none`.
  - `saveSelection` with a throwing `setItem` doesn't throw.
- [ ] **Step 2:** `npx vitest run tests/domainSelection.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `domainSelection.ts`.
- [ ] **Step 4:** `npx vitest run tests/domainSelection.test.ts`. Expected: PASS.
- [ ] **Step 5: Wire it into the UI.**
  - **Selection state:** a `ref<Set<string>>` loaded in `onMounted` from `sessionStorage` (client-only, so SSR renders unchecked boxes), and saved on every change.
  - **Checkboxes:**
    - row checkboxes have `aria-label` "Select {domain}";
    - the header checkbox uses `pageCheckState`, with the `indeterminate` DOM prop set for `some`;
    - the mobile cards get the same checkbox.
  - **`SelectionBar`:** sticky at the bottom of `<main>`, shown when the selection size > 0.
    - "{n} selected", an "Export selected" primary button and a "Clear selection" text button.
    - When the last action hit the cap: "Selection is limited to 1,000 domains."
  - **Export:**
    - `const res = await fetch("/api/domains/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domains: [...sel] }) })`.
    - On `res.ok`: `blob()`, create an object URL and click a temporary `<a download>` whose filename comes from `Content-Disposition`, falling back to `dr-domains.csv`. Revoke the URL afterwards.
    - On 429: an inline message in the bar, "Too many exports. Try again in a minute."
    - On other errors: "Export failed. Please try again."
    - The button is disabled while the export runs ("Exporting…").
- [ ] **Step 6:** `npm test && npm run typecheck`. By hand:
  - select 2 rows on page 1, change a filter, select 1 on page 3, reload: still 3 selected;
  - export, and open the CSV: header `domain,title,dr,dr_change,checked_at,page_url`, 3 rows;
  - the header checkbox shows indeterminate when partly checked;
  - 11 exports within a minute → the 429 message.
- [ ] **Step 7:** Commit: `feat(ui): persistent selection and export selected`.

---

### Task 9: Docs page

**Files:**
- Modify: `pages/docs.vue`

**Interfaces:**
- Consumes: nothing new.

- [ ] **Step 1: Restructure the page.**
  - Remove the "← Back to checker" link.
  - On `lg+`, use a two-column grid: content, plus a right column with the "On this page" nav (`sticky top-8`).
  - Below `lg`, keep the current inline TOC box (render the nav once and reposition it with responsive classes; don't duplicate the markup).
- [ ] **Step 2: Add scroll-spy.**
  - In `onMounted`, an `IntersectionObserver` (`rootMargin: "0px 0px -70% 0px"`) watches every `section[id]` and sets `activeId`.
  - The matching TOC link gets `text-accent font-medium` and `aria-current="location"`.
  - Disconnect it in `onBeforeUnmount`.
- [ ] **Step 3: Rewrite section 7.** Retitle it "7. Domains directory" and rewrite it to cover:
  - where the directory lives (the **Domains** entry in the sidebar);
  - search and filters;
  - sorting by clicking column headers;
  - what Δ means ("the DR change since that domain's previous check; — when it has only been checked once");
  - the trend line (the last 12 checks);
  - selecting rows across pages ("your selection is kept while you browse, until you close the tab");
  - **Export selected**, with its limits: up to 1,000 domains per export and 10 exports per minute.
  - Update the TOC label to match.
- [ ] **Step 4:** `npm run typecheck`. By hand at `lg`: scrolling highlights each section in turn, and the TOC stays visible. At 375px the inline TOC shows with no horizontal scroll.
- [ ] **Step 5:** Commit: `feat(docs): sticky table of contents with scroll-spy; document the domains page`.

---

### Task 10: Full verification and release

**Files:** none (verification only), plus `CLAUDE.md` if any fact it states changed.

- [ ] **Step 1: Gates.** `npm test && npm run typecheck && npm run build`. Expected: everything passes, 0 type errors, build OK.
- [ ] **Step 2: CLAUDE.md.** Update the facts it states:
  - the Results display line (the directory is now at `/domains`);
  - "Where things are" (`layouts/default.vue`, `pages/domains.vue`, `server/api/domains/export.post.ts`, the new utils);
  - the Access model rate-limit line (per-`kind` buckets: checks and exports, 10/min each).
  Commit: `docs(claude): app shell, domains page, export`.
- [ ] **Step 3: SEO regression against `npm run preview`** (or dev).
  - `curl -sI localhost:3000/domain/<known>` → 200 and `cache-control: public, s-maxage=600, stale-while-revalidate=3600`.
  - An unknown valid domain → 404 with `noindex` in the body.
  - `/domain/WWW.<known>` → 301.
  - `curl -s localhost:3000/sitemap.xml | head` and `/robots.txt` are unchanged against `main`. Diff them against a `git stash`-free run of `main` if in doubt.
- [ ] **Step 4: Database health check** (read-only Management API): the CLAUDE.md health-check query returns no rows.
- [ ] **Step 5: Push and open the PR.**
  - `git push -u origin feat/app-shell`.
  - Give the user `https://github.com/braanj/DR-checker/compare/main...feat/app-shell?expand=1&title=…&body=…`. The body is URL-encoded and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. It should list:
    - the shell;
    - the Domains page;
    - the export;
    - the migration, noting it's already applied on production;
    - the manual checks done.
  - The user merges.
- [ ] **Step 6: After the merge.**
  - `git switch main && git pull && git branch -d feat/app-shell`.
  - On https://dr-bulkchecker.netlify.app, repeat the Task 5–8 manual checks and Step 3's curls.
