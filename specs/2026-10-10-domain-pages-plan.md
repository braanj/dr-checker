# Domain Pages, DR History and Site Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every checked domain an indexable page with its DR history (Part A), then enrich it with the site's favicon, title and description, fetched safely in the background (Part B).

**Architecture:**
- **Part A:**
  - an append-only `domain_history` table, written by the existing worker and backfilled from past live checks;
  - an `/api/domain/[domain]` endpoint and an SSR page `/domain/[domain]` with SEO head tags;
  - a 404 + `noindex` response for unknown domains;
  - `sitemap.xml` and `robots.txt`.
- **Part B:**
  - a separate `fetch-meta` edge function, started by a per-minute cron through `kick_meta_worker()` (Vault-held secret);
  - it claims due domains, fetches each homepage through `safeFetch`, which blocks private addresses and caps redirects, time and size;
  - it parses the `<head>` with a dependency-free parser, stores text in `domain_meta` and the favicon in a public Storage bucket.

**Tech Stack:** Nuxt 3 / Nitro (Netlify), Supabase Postgres (pg_cron, pg_net, Vault, Storage), Supabase Edge Functions (Deno), Vitest.

**Spec:** `specs/adr/0003-domain-pages-and-metadata.md`. Read it first.

**Branch:** `feat/domain-pages` (holds the ADR commit `c839c6d`). **Part A ships as PR A; Part B then continues on a fresh branch `feat/domain-meta` cut from `main` after PR A merges.**

## Global Constraints

- **Canonical site URL:** `https://dr-bulkchecker.netlify.app`, exposed as `runtimeConfig.public.siteUrl` (env `SITE_URL` overrides).
- **Domain page path:** `/domain/<normalized domain>`. Normalization is `normalizeDomain` (`server/utils/domain.ts`).
- **History:** only `ok` results with a numeric DR, one row per `(domain, checked_at)`. The API returns ≤ **100** points, newest first.
- **Unknown / `no_data` domain:**
  - HTTP **404** with `<meta name="robots" content="noindex">`, plus a "Check its DR now" button;
  - the CDN cache header is sent **only on 200** pages: `public, s-maxage=600, stale-while-revalidate=3600`.
- **Sitemap:** `/`, `/docs` and every `ok` domain with `lastmod`, sent with `Cache-Control: public, s-maxage=3600`. **Read in pages of 1,000** (PostgREST `max_rows = 1000`).
- **robots.txt:**
  - `Allow: /`
  - `Disallow: /api/`
  - `Disallow: /results/`
  - a `Sitemap:` line with the absolute URL.
- **Metadata cadence:** due when never fetched, `ok` and older than **30 days**, `error` and older than **7 days**, or claimed more than **2 minutes** ago and unfinished.
- **Metadata run:** at most **5** domains per run, no new domain after a **60 s** budget, and a **20 s** hard deadline per domain. pg_net timeout **120 s**. The cron job **`fetch-meta`** runs every minute.
- **safeFetch:**
  - only `http`/`https`, ports 80/443, at most **3** redirects (each re-validated);
  - **8 s** per request;
  - HTML cut off at **512 KB** or at `</head>`; favicons at most **100 KB**, otherwise an error;
  - every resolved address is checked by `isBlockedAddress`.
- **Blocked ranges:** 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16, 224/4 and above; `::`, `::1`, fc00::/7, fe80::/10, ff00::/8; plus IPv4-mapped (`::ffff:a.b.c.d`), IPv4-compatible (`::a.b.c.d`) and NAT64 (`64:ff9b::/96`) forms of blocked IPv4. Unparseable addresses count as blocked.
- **Parsing:** the title falls back to `og:title` and the description to `og:description`. Entities are decoded, whitespace collapsed, and the title capped at **200** characters, the description at **500**.
- **Favicon candidate order:** png/svg `icon`, then other `icon`, then `apple-touch-icon`, then `/favicon.ico`. Only http/https URLs; at most the first **2** candidates are tried.
- **Favicon content types:** `image/png`, `image/x-icon`, `image/vnd.microsoft.icon`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`. They are stored as `favicons/<domain>.<ext>`.
- **User-Agent:** `DRCheckerBot/1.0 (+https://dr-bulkchecker.netlify.app)`.
- **No new anon access:** RLS is on with no policies, and every new RPC has execute revoked from `public, anon, authenticated`. The `favicons` bucket is public-read only.
- **Gate for every task:** `npm test` and `npm run typecheck` pass. Run `deno check` for each edge-function entrypoint touched, then delete any `deno.lock` it creates. After every migration: `npm run gen:types` and commit the result.
- **Release:** each part is pushed from its branch, verified on production, then goes through a PR and merge (Netlify deploys on merge). Production DB writes:
  - `db push` / `functions deploy`: Claude, under the allow rules;
  - the provisioning script: the user.

## Deliberate deviations from ADR 0003 (decided while planning)

- **History index:** `unique (domain, checked_at)` serves "newest first per domain" through a backward index scan, so the separate `(domain, checked_at desc)` index is dropped as redundant.
- **Claiming:** `claim_meta_domains` is called with `p_limit = 1` in a loop (at most 5 per run, 60 s budget). Claiming 5 at once would strand claimed but unstarted domains for 2 minutes whenever the budget runs out.
- **`domain_meta.status`:** allows `null`, meaning "never fetched". The claim RPC inserts placeholder rows so they can be locked with `SKIP LOCKED`.
- **Per-domain deadline (20 s):** not in the ADR. Without it, one domain's worst case (https and http chains plus 2 favicon chains, 8 s per request) exceeds 100 s, which breaks the 150 s wall clock. Pinned by `tests/metaLimits.test.ts`.
- **CDN cache header:** sent only on 200 pages, not via a route rule. A 404 that gets cached would hide a domain for up to 10 minutes after someone checks it.

## Review Focus

1. **More than 1,000 `ok` domains:** PostgREST silently caps a select at 1,000 rows. The sitemap must page through, or it quietly drops domains. Pinned in Task A6 (`fetchAllOkDomains` paging test).
2. **A redirect chain that ends at a private address or a non-80/443 port:** it must be refused before any request reaches it. Pinned in Task B3 (redirect-to-127.0.0.1 and port-8080 tests).
3. **A tarpit site** that answers every request just under 8 s through 3 redirects, on both https and http: the per-domain 20 s deadline must stop it, and `budget + perDomain` must stay under the 150 s edge wall clock. Pinned in Task B3 (shared deadline test) and Task B5 (`metaLimits` invariant test).
4. **Hostile or sloppy HTML:** no `</head>`, uppercase tags, single-quoted or unquoted attributes, entities, a 10 KB title, `data:` icon URLs. The parser must stay sane and capped. Pinned in Task B2.
5. **Odd domain paths:** `/domain/WWW.Example.COM` and `example.com%2Fpage` must 301 to the canonical path, and garbage must end as 404 + `noindex`. Pinned in Task A3 (`resolveDomainParam` tests). Task A5 handles the redirect.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/20261014000000_domain_history.sql` (A1) | `domain_history` table + backfill |
| `supabase/functions/process-queue/outcome.ts`, `index.ts` (A2) | `historyWriteFor` + history insert |
| `utils/domainPath.ts` (A3) | `resolveDomainParam`, `domainPath` |
| `utils/domainView.ts` (A4) | `DomainView` type, `domainSeo`, `sparklinePath` |
| `utils/checkedAgo.ts` (A4) | shared "N days ago" (extracted from `CheckResults.vue`) |
| `server/api/domain/[domain].get.ts` (A4) | domain + history (+ meta in B6) |
| `pages/domain/[domain].vue` (A5) | SSR page, 301/404, head tags, re-check |
| `server/utils/sitemap.ts`, `server/routes/sitemap.xml.ts`, `server/routes/robots.txt.ts` (A6) | crawling |
| `pages/index.vue`, `components/CheckResults.vue` (A6) | links to domain pages |
| `supabase/functions/fetch-meta/netguard.ts` (B1) | `isBlockedAddress` |
| `supabase/functions/fetch-meta/parseHead.ts` (B2) | `extractMeta`, `iconExtension` |
| `supabase/functions/fetch-meta/safeFetch.ts` (B3) | guarded fetch + limits |
| `supabase/migrations/20261015000000_domain_meta.sql` (B4) | `domain_meta`, `meta_due`, `claim_meta_domains`, `kick_meta_worker`, cron, bucket |
| `supabase/functions/_shared/auth.ts` (B5, moved) | shared secret check |
| `supabase/functions/fetch-meta/index.ts` (B5) | the run loop |
| `scripts/provision-worker-secret.sh` (B6) | also sets `meta_worker_url` |

---

# Part A: history, page and SEO (branch `feat/domain-pages`, PR A)

### Task A1: `domain_history` migration

**Files:**
- Create: `supabase/migrations/20261014000000_domain_history.sql`
- Modify: `supabase/schema.sql` (append the table after `check_requests`)
- Modify (generated): `supabase/functions/_shared/database.types.ts`

**Interfaces:**
- Produces: the table `public.domain_history(id bigint, domain text, dr numeric, checked_at timestamptz)` with `unique (domain, checked_at)`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- ADR 0003 (Part A): one row per real Ahrefs reading. Written by the
-- process-queue worker on every `ok` result; backfilled from past live checks.
-- ============================================================================

create table if not exists public.domain_history (
  id         bigint generated always as identity primary key,
  domain     text not null,
  dr         numeric not null,
  checked_at timestamptz not null,
  unique (domain, checked_at)  -- also serves "latest first per domain" (backward index scan)
);
alter table public.domain_history enable row level security;

insert into public.domain_history (domain, dr, checked_at)
select distinct on (domain, checked_at) domain, dr, checked_at
from public.urls
where source = 'live' and dr is not null and checked_at is not null
order by domain, checked_at
on conflict (domain, checked_at) do nothing;
```

- [ ] **Step 2: Mirror the table in `supabase/schema.sql`**

Add the `create table … ;` and `alter table … enable row level security;` statements (without the backfill) right after the `check_requests` table block. Also add `alter table public.domain_history enable row level security;` to the RLS section, next to the other four tables.

- [ ] **Step 3: Parse-check**

Run: `node /private/tmp/claude-501/-Users-brahim-Work-projects-dr-checker/e522dd7c-e050-4227-8a3a-338bb3ca45f5/scratchpad/pgparse/check.mjs supabase/schema.sql supabase/migrations/20261014000000_domain_history.sql`.
Expected: `OK` for both.

- [ ] **Step 4: Apply and regenerate types (production DB write, Claude, allow rule)**

```bash
export PATH=$HOME/.nvm/versions/node/v24.16.0/bin:$PATH
export SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env | cut -d= -f2- | tr -d '"'"'"' \r')
echo y | npx -y supabase@2.109.0 db push
npm run gen:types
grep -n "domain_history" supabase/functions/_shared/database.types.ts | head -2
```
Expected: the push applies only `20261014000000`, and `database.types.ts` now contains `domain_history`.

Then read-only: `select count(*), count(distinct domain) from public.domain_history`.
Expected: about one row per live reading. That is at least the number of `ok` domains with live rows (~590), and the count is greater than 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261014000000_domain_history.sql supabase/schema.sql supabase/functions/_shared/database.types.ts
git commit -m "feat(db): domain_history table with backfill from live checks"
```

---

### Task A2: The worker writes history

**Files:**
- Modify: `supabase/functions/process-queue/outcome.ts` (add `historyWriteFor`)
- Modify: `supabase/functions/process-queue/index.ts` (insert after the `domains` upsert)
- Test: `tests/outcome.test.ts` (append)

**Interfaces:**
- Consumes: `AhrefsResult` (`outcome.ts`) and the `domain_history` table (A1).
- Produces: `historyWriteFor(result: AhrefsResult): { dr: number } | null`.

- [ ] **Step 1: Write the failing test**

Append to `tests/outcome.test.ts`:

```ts
import { historyWriteFor } from "../supabase/functions/process-queue/outcome";

describe("historyWriteFor", () => {
  it("records every ok reading, including DR 0", () => {
    expect(historyWriteFor({ kind: "ok", dr: 71 })).toEqual({ dr: 71 });
    expect(historyWriteFor({ kind: "ok", dr: 0 })).toEqual({ dr: 0 });
  });

  it("never records no_data or transient results", () => {
    expect(historyWriteFor({ kind: "no_data" })).toBeNull();
    expect(historyWriteFor({ kind: "transient", error: "Ahrefs HTTP 429" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL, because `historyWriteFor` is not exported (it is undefined).

- [ ] **Step 3: Implement it**

In `outcome.ts`, after `cacheWriteFor`:

```ts
// Only real readings become history; no_data and transient results never do.
export function historyWriteFor(result: AhrefsResult): { dr: number } | null {
  return result.kind === "ok" ? { dr: result.dr } : null;
}
```

In `index.ts`:
- Add `historyWriteFor` to the `./outcome.ts` import list.
- Right after the `if (cacheWrite) { … }` block in `processBatch`, add:

```ts
    const history = historyWriteFor(result);
    if (history) {
      writes.push(
        supabase
          .from("domain_history")
          .upsert(
            { domain, dr: history.dr, checked_at: checkedAt.toISOString() },
            { onConflict: "domain,checked_at", ignoreDuplicates: true },
          )
          .then(({ error }) => {
            if (error) console.error("domain_history insert failed", domain, error.message);
          }),
      );
    }
```

- [ ] **Step 4: Run the gate**

Run: `npm test && npm run typecheck && deno check supabase/functions/process-queue/index.ts; rm -f deno.lock`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/process-queue/outcome.ts supabase/functions/process-queue/index.ts tests/outcome.test.ts
git commit -m "feat(worker): append a domain_history row for every ok reading"
```

---

### Task A3: Domain path helpers

**Files:**
- Create: `utils/domainPath.ts`
- Test: `tests/domainPath.test.ts`

**Interfaces:**
- Consumes: `normalizeDomain` (`server/utils/domain.ts`).
- Produces:
  - `resolveDomainParam(raw: string): { domain: string; canonical: boolean } | null`
  - `domainPath(domain: string): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { domainPath, resolveDomainParam } from "../utils/domainPath";

describe("resolveDomainParam", () => {
  it("accepts an already canonical domain", () => {
    expect(resolveDomainParam("example.com")).toEqual({ domain: "example.com", canonical: true });
    expect(resolveDomainParam("blog.example.com")).toEqual({ domain: "blog.example.com", canonical: true });
  });

  it("flags spellings that must redirect to the canonical path", () => {
    expect(resolveDomainParam("WWW.Example.COM")).toEqual({ domain: "example.com", canonical: false });
    expect(resolveDomainParam("example.com%2Fpage")).toEqual({ domain: "example.com", canonical: false });
    expect(resolveDomainParam("https%3A%2F%2Fexample.com")).toEqual({ domain: "example.com", canonical: false });
  });

  it("rejects garbage", () => {
    expect(resolveDomainParam("localhost")).toBeNull();
    expect(resolveDomainParam("not a domain")).toBeNull();
    expect(resolveDomainParam("%E0%A4%A")).toBeNull();
    expect(resolveDomainParam("")).toBeNull();
  });
});

describe("domainPath", () => {
  it("builds the page path", () => {
    expect(domainPath("example.com")).toBe("/domain/example.com");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL, because `../utils/domainPath` cannot be resolved.

- [ ] **Step 3: Implement `utils/domainPath.ts`**

```ts
// Canonical /domain/<domain> paths. The route param may arrive percent-encoded
// or in a non-canonical spelling; pages 301 to the canonical form.

import { normalizeDomain } from "../server/utils/domain";

export function resolveDomainParam(raw: string): { domain: string; canonical: boolean } | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const domain = normalizeDomain(decoded);
  if (!domain) return null;
  return { domain, canonical: raw === domain };
}

export function domainPath(domain: string): string {
  return `/domain/${domain}`;
}
```

- [ ] **Step 4: Run the gate**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add utils/domainPath.ts tests/domainPath.test.ts
git commit -m "feat(pages): canonical domain path helpers"
```

---

### Task A4: View model, SEO text, sparkline and the domain API

**Files:**
- Create: `utils/domainView.ts`, `utils/checkedAgo.ts`, `server/api/domain/[domain].get.ts`
- Modify: `components/CheckResults.vue` (use the shared `checkedAgo`), `nuxt.config.ts` (`runtimeConfig.public.siteUrl`)
- Test: `tests/domainView.test.ts`

**Interfaces:**
- Consumes: `supabaseAdmin()`, `normalizeDomain`.
- Produces:
  - `interface DomainView { domain: string; dr: number; checked_at: string; history: { dr: number; checked_at: string }[]; meta: DomainMetaView | null }`
  - `interface DomainMetaView { title: string | null; description: string | null; favicon_url: string | null }`
  - `domainSeo(view: DomainView, siteUrl: string): { title: string; description: string; canonical: string }`
  - `sparklinePath(values: number[], width: number, height: number): string`
  - `checkedAgo(iso: string, now?: number): string`
  - `GET /api/domain/:domain` returns a `DomainView` (with `meta: null` until B6), or 404.

- [ ] **Step 1: Write the failing tests**

`tests/domainView.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { domainSeo, sparklinePath, type DomainView } from "../utils/domainView";
import { checkedAgo } from "../utils/checkedAgo";

const view: DomainView = {
  domain: "example.com",
  dr: 91.6,
  checked_at: "2026-10-01T12:00:00Z",
  history: [],
  meta: null,
};

describe("domainSeo", () => {
  it("builds title, description and canonical URL from the DR", () => {
    expect(domainSeo(view, "https://dr-bulkchecker.netlify.app")).toEqual({
      title: "example.com Domain Rating (DR 92) | DR Checker",
      description: "example.com has an Ahrefs Domain Rating of 92 (checked 2026-10-01).",
      canonical: "https://dr-bulkchecker.netlify.app/domain/example.com",
    });
  });

  it("appends the site description and caps the result at 300 characters", () => {
    const seo = domainSeo({ ...view, meta: { title: null, description: "x".repeat(400), favicon_url: null } }, "https://s");
    expect(seo.description.startsWith("example.com has an Ahrefs Domain Rating of 92 (checked 2026-10-01). xxx")).toBe(true);
    expect(seo.description.length).toBe(300);
    expect(seo.description.endsWith("…")).toBe(true);
  });
});

describe("sparklinePath", () => {
  it("is empty for fewer than two points", () => {
    expect(sparklinePath([], 100, 20)).toBe("");
    expect(sparklinePath([50], 100, 20)).toBe("");
  });

  it("scales oldest-to-newest values across the box, higher DR drawn higher", () => {
    expect(sparklinePath([10, 20, 30], 100, 20)).toBe("M0,20 L50,10 L100,0");
  });

  it("draws a flat line through the middle when all values are equal", () => {
    expect(sparklinePath([40, 40], 100, 20)).toBe("M0,10 L100,10");
  });
});

describe("checkedAgo", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  it("says today, 1 day ago, or N days ago", () => {
    expect(checkedAgo("2026-10-10T08:00:00Z", now)).toBe("today");
    expect(checkedAgo("2026-10-09T08:00:00Z", now)).toBe("1 day ago");
    expect(checkedAgo("2026-09-30T12:00:00Z", now)).toBe("10 days ago");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL, because `../utils/domainView` and `../utils/checkedAgo` cannot be resolved.

- [ ] **Step 3: Implement the utilities**

`utils/checkedAgo.ts`:

```ts
export function checkedAgo(iso: string, now: number = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
```

`utils/domainView.ts`:

```ts
// Shape of GET /api/domain/:domain and the pure helpers the domain page uses.

export interface DomainMetaView {
  title: string | null;
  description: string | null;
  favicon_url: string | null;
}

export interface DomainView {
  domain: string;
  dr: number;
  checked_at: string;
  history: { dr: number; checked_at: string }[]; // newest first
  meta: DomainMetaView | null;
}

const DESCRIPTION_MAX = 300;

function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function domainSeo(view: DomainView, siteUrl: string) {
  const dr = Math.round(view.dr);
  const base = `${view.domain} has an Ahrefs Domain Rating of ${dr} (checked ${view.checked_at.slice(0, 10)}).`;
  const description = view.meta?.description ? cap(`${base} ${view.meta.description}`, DESCRIPTION_MAX) : base;
  return {
    title: `${view.domain} Domain Rating (DR ${dr}) | DR Checker`,
    description,
    canonical: `${siteUrl}/domain/${view.domain}`,
  };
}

// SVG path for oldest→newest values; y grows downward, so higher DR is drawn higher.
export function sparklinePath(values: number[], width: number, height: number): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = width / (values.length - 1);
  const y = (v: number) => (max === min ? height / 2 : height - ((v - min) / (max - min)) * height);
  return values
    .map((v, i) => `${i === 0 ? "M" : "L"}${Math.round(i * step * 100) / 100},${Math.round(y(v) * 100) / 100}`)
    .join(" ");
}
```

In `components/CheckResults.vue`, delete the local `function checkedAgo(iso: string) { … }`. The template keeps calling `checkedAgo(row.checked_at)`, which is now auto-imported from `utils/`.

In `nuxt.config.ts`, add `siteUrl: process.env.SITE_URL ?? "https://dr-bulkchecker.netlify.app",` inside `runtimeConfig.public`.

- [ ] **Step 4: Implement `server/api/domain/[domain].get.ts`**

```ts
// Public: one domain's current DR and its history, for /domain/[domain].
// 404 unless the domain has an `ok` reading (no thin pages, ADR 0003).

import { supabaseAdmin } from "../../utils/supabaseAdmin";
import { normalizeDomain } from "../../utils/domain";
import type { DomainView } from "../../../utils/domainView";

const HISTORY_LIMIT = 100;

export default defineEventHandler(async (event): Promise<DomainView> => {
  const domain = normalizeDomain(getRouterParam(event, "domain", { decode: true }) ?? "");
  if (!domain) throw createError({ statusCode: 404, statusMessage: "Unknown domain" });

  const admin = supabaseAdmin();
  const { data: row, error } = await admin
    .from("domains")
    .select("domain, dr, checked_at")
    .eq("domain", domain)
    .eq("status", "ok")
    .maybeSingle();
  if (error) throw createError({ statusCode: 500, statusMessage: error.message });
  if (!row || row.dr === null) throw createError({ statusCode: 404, statusMessage: "Unknown domain" });

  const { data: history, error: historyError } = await admin
    .from("domain_history")
    .select("dr, checked_at")
    .eq("domain", domain)
    .order("checked_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (historyError) throw createError({ statusCode: 500, statusMessage: historyError.message });

  return { domain: row.domain, dr: row.dr, checked_at: row.checked_at, history: history ?? [], meta: null };
});
```

- [ ] **Step 5: Run the gate**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add utils/domainView.ts utils/checkedAgo.ts server/api/domain components/CheckResults.vue nuxt.config.ts tests/domainView.test.ts
git commit -m "feat(api): domain view endpoint, SEO text and sparkline helpers"
```

---

### Task A5: The SSR domain page

**Files:**
- Create: `pages/domain/[domain].vue`

**Interfaces:**
- Consumes:
  - `resolveDomainParam`, `domainPath` (A3);
  - `DomainView`, `domainSeo`, `sparklinePath` (A4);
  - `checkedAgo` (A4);
  - `CheckResponse` (`server/utils/createCheck.ts`);
  - `<CheckResults>`;
  - `/api/check`, `/api/domain/:domain`.
- Produces: the route `/domain/:domain`.

- [ ] **Step 1: Write `pages/domain/[domain].vue`**

```vue
<template>
  <div class="mx-auto max-w-3xl px-4 py-16">
    <NuxtLink to="/" class="text-sm text-[#6e6e73] transition-colors hover:text-accent">← Domain directory</NuxtLink>

    <template v-if="view">
      <div class="mt-6 flex items-center gap-4">
        <img v-if="view.meta?.favicon_url" :src="view.meta.favicon_url" alt="" width="40" height="40"
          class="h-10 w-10 shrink-0 rounded-lg" />
        <div class="min-w-0">
          <h1 class="break-all text-3xl font-semibold tracking-tight text-[#1d1d1f]">{{ view.domain }}</h1>
          <p class="text-sm text-[#6e6e73]">checked {{ checkedAgo(view.checked_at) }}</p>
        </div>
        <div class="ml-auto text-right">
          <div class="text-5xl font-semibold tracking-tight text-[#1d1d1f]">{{ view.dr }}</div>
          <div class="text-xs text-[#86868b]">Domain Rating</div>
        </div>
      </div>

      <div v-if="view.meta?.title || view.meta?.description"
        class="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <p class="text-xs font-medium text-[#86868b]">From the site</p>
        <p v-if="view.meta?.title" class="mt-1 font-medium text-[#1d1d1f]">{{ view.meta.title }}</p>
        <p v-if="view.meta?.description" class="mt-1 text-sm text-[#424245]">{{ view.meta.description }}</p>
      </div>

      <section class="mt-8 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <h2 class="text-sm font-medium text-[#1d1d1f]">DR over time</h2>
        <svg v-if="view.history.length > 1" class="mt-3 h-16 w-full" viewBox="0 0 300 60" preserveAspectRatio="none"
          role="img" :aria-label="`DR history for ${view.domain}`">
          <path :d="sparklinePath([...view.history].reverse().map((h) => h.dr), 300, 60)" fill="none"
            stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" class="text-accent" />
        </svg>
        <table class="mt-3 w-full text-sm">
          <thead>
            <tr class="text-left text-[#6e6e73]">
              <th class="py-1.5 font-medium">Checked</th>
              <th class="py-1.5 font-medium">DR</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in view.history" :key="h.checked_at" class="border-t border-black/5">
              <td class="py-1.5">{{ new Date(h.checked_at).toLocaleDateString() }}</td>
              <td class="py-1.5 font-medium">{{ h.dr }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <div v-else class="mt-6">
      <h1 class="break-all text-3xl font-semibold tracking-tight text-[#1d1d1f]">
        We haven't checked {{ domainName }} yet
      </h1>
      <p class="mt-2 text-[#6e6e73]">Check it now. The result is added to the public directory.</p>
    </div>

    <button type="button" :disabled="checking || !param"
      class="mt-8 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-black/20"
      @click="recheck">
      {{ checking ? "Checking…" : view ? "Re-check" : "Check its DR now" }}
    </button>
    <p v-if="checkError" class="mt-3 text-sm text-red-600">{{ checkError }}</p>

    <CheckResults v-if="checkId" :key="checkId" :batch-id="checkId" :show-title="false" />
  </div>
</template>

<script setup lang="ts">
import type { DomainView } from "~/utils/domainView";
import type { CheckResponse } from "~/server/utils/createCheck";

const route = useRoute();
const config = useRuntimeConfig();

const raw = String(route.params.domain ?? "");
const param = resolveDomainParam(raw);
if (param && !param.canonical) {
  await navigateTo(domainPath(param.domain), { redirectCode: 301 });
}
const domainName = param?.domain ?? raw;

const { data: view } = param
  ? await useFetch<DomainView>(`/api/domain/${encodeURIComponent(param.domain)}`, { key: `domain-${param.domain}` })
  : { data: ref<DomainView | null>(null) };

if (!view.value) {
  if (import.meta.server) setResponseStatus(useRequestEvent()!, 404);
  useHead({
    title: `${domainName}: not checked yet | DR Checker`,
    meta: [{ name: "robots", content: "noindex" }],
  });
} else {
  useResponseHeader("Cache-Control").value = "public, s-maxage=600, stale-while-revalidate=3600";
  const seo = domainSeo(view.value, config.public.siteUrl as string);
  useHead({
    title: seo.title,
    meta: [
      { name: "description", content: seo.description },
      { property: "og:title", content: seo.title },
      { property: "og:description", content: seo.description },
    ],
    link: [{ rel: "canonical", href: seo.canonical }],
  });
}

const checking = ref(false);
const checkError = ref("");
const checkId = ref<string | null>(null);

async function recheck() {
  if (!param) return;
  checking.value = true;
  checkError.value = "";
  try {
    const res = await $fetch<CheckResponse>("/api/check", { method: "POST", body: { domains: param.domain } });
    checkId.value = res.batchId;
  } catch (e: any) {
    checkError.value = e?.data?.statusMessage ?? "Check failed. Please try again.";
  } finally {
    checking.value = false;
  }
}
</script>
```

- [ ] **Step 2: Run the gate**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 3: Smoke-test against production data with the built server (read-only)**

```bash
(PORT=3125 node --env-file=.env .output/server/index.mjs > /tmp/serve-a5.log 2>&1 &)
sleep 3
curl -s -o /tmp/known.html -w "known %{http_code}\n" localhost:3125/domain/python.org
grep -o '<title>[^<]*</title>\|rel="canonical"[^>]*\|s-maxage' /tmp/known.html | head -3
curl -s -D - -o /dev/null localhost:3125/domain/python.org | grep -i "cache-control"
curl -s -o /tmp/unknown.html -w "unknown %{http_code}\n" localhost:3125/domain/zzz-never-checked-9183.com
grep -o 'noindex' /tmp/unknown.html | head -1
curl -s -o /dev/null -w "redirect %{http_code} -> %{redirect_url}\n" localhost:3125/domain/WWW.Python.ORG
pkill -f ".output/server/index.mjs"; rm -f /tmp/known.html /tmp/unknown.html /tmp/serve-a5.log
```

Expected:
- `known 200`, with a `<title>python.org Domain Rating (DR …) | DR Checker</title>`, a canonical link and `cache-control: public, s-maxage=600, …`;
- `unknown 404` with `noindex`;
- `redirect 301 -> …/domain/python.org`.

- [ ] **Step 4: Commit**

```bash
git add "pages/domain/[domain].vue"
git commit -m "feat(pages): SSR domain page with history, SEO head, 404 noindex and re-check"
```

---

### Task A6: Links, sitemap and robots

**Files:**
- Create: `server/utils/sitemap.ts`, `server/routes/sitemap.xml.ts`, `server/routes/robots.txt.ts`
- Modify: `pages/index.vue` (directory domain cell), `components/CheckResults.vue` (Domain cell)
- Test: `tests/sitemap.test.ts`

**Interfaces:**
- Consumes: `supabaseAdmin()`, `domainPath` (A3).
- Produces:
  - `fetchAllOkDomains(admin: SupabaseClient<Database>, pageSize?: number): Promise<{ domain: string; checked_at: string }[]>`
  - `buildSitemap(siteUrl: string, domains: { domain: string; checked_at: string }[]): string`
  - `buildRobots(siteUrl: string): string`

- [ ] **Step 1: Write the failing tests**

`tests/sitemap.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildRobots, buildSitemap, fetchAllOkDomains } from "../server/utils/sitemap";

describe("buildSitemap", () => {
  it("lists static pages and every domain with lastmod, XML-escaped", () => {
    const xml = buildSitemap("https://s.test", [{ domain: "a&b.com", checked_at: "2026-10-01T12:00:00Z" }]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<loc>https://s.test/</loc>");
    expect(xml).toContain("<loc>https://s.test/docs</loc>");
    expect(xml).toContain("<url><loc>https://s.test/domain/a&amp;b.com</loc><lastmod>2026-10-01</lastmod></url>");
  });
});

describe("buildRobots", () => {
  it("allows pages, hides api/results, points at the sitemap", () => {
    expect(buildRobots("https://s.test")).toBe(
      "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /results/\nSitemap: https://s.test/sitemap.xml\n",
    );
  });
});

describe("fetchAllOkDomains", () => {
  it("pages past the 1,000-row cap until a short page", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => ({ domain: `d${i}.com`, checked_at: "2026-10-01T00:00:00Z" }));
    const ranges: [number, number][] = [];
    const fake = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              range: async (from: number, to: number) => {
                ranges.push([from, to]);
                return { data: all.slice(from, Math.min(to + 1, from + 1000)), error: null };
              },
            }),
          }),
        }),
      }),
    };
    const rows = await fetchAllOkDomains(fake as never, 1000);
    expect(rows).toHaveLength(2500);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL, because `../server/utils/sitemap` cannot be resolved.

- [ ] **Step 3: Implement `server/utils/sitemap.ts`**

```ts
// sitemap.xml / robots.txt builders (ADR 0003). PostgREST caps a select at
// max_rows (1,000), so domains are read page by page.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../supabase/functions/_shared/database.types";

type OkDomain = { domain: string; checked_at: string };

export async function fetchAllOkDomains(
  admin: SupabaseClient<Database>,
  pageSize = 1000,
): Promise<OkDomain[]> {
  const rows: OkDomain[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("domains")
      .select("domain, checked_at")
      .eq("status", "ok")
      .order("domain")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function buildSitemap(siteUrl: string, domains: OkDomain[]): string {
  const urls = [
    `<url><loc>${escapeXml(`${siteUrl}/`)}</loc></url>`,
    `<url><loc>${escapeXml(`${siteUrl}/docs`)}</loc></url>`,
    ...domains.map(
      (d) =>
        `<url><loc>${escapeXml(`${siteUrl}/domain/${d.domain}`)}</loc><lastmod>${d.checked_at.slice(0, 10)}</lastmod></url>`,
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export function buildRobots(siteUrl: string): string {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /results/\nSitemap: ${siteUrl}/sitemap.xml\n`;
}
```

- [ ] **Step 4: Implement the routes**

`server/routes/sitemap.xml.ts`:

```ts
import { supabaseAdmin } from "../utils/supabaseAdmin";
import { buildSitemap, fetchAllOkDomains } from "../utils/sitemap";

export default defineEventHandler(async (event) => {
  const domains = await fetchAllOkDomains(supabaseAdmin());
  setResponseHeaders(event, {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, s-maxage=3600",
  });
  return buildSitemap(useRuntimeConfig().public.siteUrl as string, domains);
});
```

`server/routes/robots.txt.ts`:

```ts
import { buildRobots } from "../utils/sitemap";

export default defineEventHandler((event) => {
  setResponseHeaders(event, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=3600" });
  return buildRobots(useRuntimeConfig().public.siteUrl as string);
});
```

- [ ] **Step 5: Link domain cells**

In `pages/index.vue`, replace `<td class="py-2.5 px-4 break-all">{{ d.domain }}</td>` with:

```vue
                  <td class="py-2.5 px-4 break-all">
                    <NuxtLink :to="domainPath(d.domain)" class="transition-colors hover:text-accent">{{ d.domain }}</NuxtLink>
                  </td>
```

In `components/CheckResults.vue`, replace `<td class="py-2.5 px-4 text-[#6e6e73]">{{ row.domain }}</td>` with:

```vue
                <td class="py-2.5 px-4 text-[#6e6e73]">
                  <NuxtLink :to="domainPath(row.domain)" class="transition-colors hover:text-accent">{{ row.domain }}</NuxtLink>
                </td>
```

- [ ] **Step 6: Run the gate and smoke-test**

Run: `npm test && npm run typecheck && npm run build`, then serve the build:

```bash
(PORT=3126 node --env-file=.env .output/server/index.mjs > /tmp/serve-a6.log 2>&1 &); sleep 3
curl -s localhost:3126/sitemap.xml | grep -c "<url>"
curl -s localhost:3126/robots.txt
pkill -f ".output/server/index.mjs"; rm -f /tmp/serve-a6.log
```

Expected:
- the `<url>` count equals the number of `ok` domains + 2 (check read-only: `select count(*) from domains where status='ok'`);
- robots.txt matches the `buildRobots` output.

- [ ] **Step 7: Commit**

```bash
git add server/utils/sitemap.ts server/routes tests/sitemap.test.ts pages/index.vue components/CheckResults.vue
git commit -m "feat(seo): sitemap.xml, robots.txt and links to domain pages"
```

---

### Task A7: Docs and PR A rollout

**Files:**
- Modify: `CLAUDE.md` (Key files + an architecture note), `pages/docs.vue` (§7 "Domain directory")

- [ ] **Step 1: Docs**
  - **CLAUDE.md Key files:** add `server/api/domain/[domain].get.ts`, `pages/domain/[domain].vue`, `server/routes/sitemap.xml.ts` / `robots.txt.ts`, and `utils/` (domainPath, domainView, checkedAgo, retry).
  - **CLAUDE.md architecture:** add the sentence: "The worker also appends `domain_history` on every `ok` reading (ADR 0003); domain pages are SSR, 404 + noindex unless the domain has an `ok` DR."
  - **`pages/docs.vue` §7:** append "Click a domain to open its page: current DR, DR history and a Re-check button."

- [ ] **Step 2: Gate, deploy the worker, push and open the PR**

```bash
npm test && npm run typecheck && npm run build
export PATH=$HOME/.nvm/versions/node/v24.16.0/bin:$PATH
export SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env | cut -d= -f2- | tr -d '"'"'"' \r')
npx -y supabase@2.109.0 functions deploy process-queue --no-verify-jwt
git add CLAUDE.md pages/docs.vue && git commit -m "docs: domain pages and history"
git push -u origin feat/domain-pages
```

Then open the prefilled PR URL, the same way as in previous steps.

- [ ] **Step 3: Verify (after deploy + merge)**
  - **Before merge** (worker deployed): type 1 uncached domain, then read-only `select * from domain_history where domain = '<it>'`. Expected: 1 row.
  - **After the user merges** (Netlify):
    - `/domain/python.org` returns 200 with title, canonical and `s-maxage`;
    - an unknown domain returns 404 with `noindex` and no `s-maxage`;
    - `/domain/WWW.Python.ORG` returns 301;
    - `/sitemap.xml` has `ok` count + 2 entries;
    - `/robots.txt` is served.

---

# Part B: site metadata (branch `feat/domain-meta` from `main` after PR A merges, PR B)

### Task B1: `isBlockedAddress`

**Files:**
- Create: `supabase/functions/fetch-meta/netguard.ts`
- Test: `tests/netguard.test.ts`

**Interfaces:**
- Produces: `isBlockedAddress(ip: string): boolean` (`true` for unparseable input).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { isBlockedAddress } from "../supabase/functions/fetch-meta/netguard";

describe("isBlockedAddress", () => {
  it("blocks every private/reserved IPv4 range", () => {
    for (const ip of [
      "0.1.2.3", "10.0.0.1", "100.64.0.1", "100.127.255.255", "127.0.0.1", "169.254.169.254",
      "172.16.0.1", "172.31.255.255", "192.168.1.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
    ]) expect(isBlockedAddress(ip), ip).toBe(true);
  });

  it("allows public IPv4, including the edges just outside blocked ranges", () => {
    for (const ip of ["8.8.8.8", "100.63.255.255", "100.128.0.1", "172.15.255.255", "172.32.0.1", "223.255.255.255"])
      expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it("blocks IPv6 loopback, unspecified, ULA, link-local, multicast", () => {
    for (const ip of ["::1", "::", "fc00::1", "fdff::1", "fe80::1", "febf::1", "ff02::1", "[::1]", "fe80::1%eth0"])
      expect(isBlockedAddress(ip), ip).toBe(true);
  });

  it("blocks IPv4-mapped, IPv4-compatible and NAT64 forms of blocked IPv4", () => {
    for (const ip of ["::ffff:127.0.0.1", "::ffff:7f00:1", "::127.0.0.1", "64:ff9b::a9fe:a9fe", "64:ff9b::10.0.0.1"])
      expect(isBlockedAddress(ip), ip).toBe(true);
  });

  it("allows public IPv6 and mapped public IPv4", () => {
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"])
      expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it("fails closed on garbage", () => {
    for (const ip of ["", "example.com", "1.2.3", "1.2.3.256", "1::2::3", "gggg::1"])
      expect(isBlockedAddress(ip), ip).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Implement `supabase/functions/fetch-meta/netguard.ts`**

```ts
// Address guard for outbound metadata fetches (ADR 0003). Every resolved
// address of every request hop must pass. Unparseable input fails closed.

function parseIPv4(s: string): number[] | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const n = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return n.every((x) => x >= 0 && x <= 255) ? n : null;
}

function blockedV4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast 224/4, reserved 240/4, broadcast
  );
}

function parseIPv6(input: string): number[] | null {
  let s = input.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const tail: number[] = [];
  if (s.includes(".")) {
    // dotted IPv4 tail (::ffff:1.2.3.4, ::1.2.3.4, 64:ff9b::10.0.0.1) → two hextets
    const idx = s.lastIndexOf(":");
    const v4 = parseIPv4(s.slice(idx + 1));
    if (!v4) return null;
    tail.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
    const prefix = s.slice(0, idx + 1);
    s = prefix.endsWith("::") ? prefix : s.slice(0, idx);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const hex = (part: string) =>
    part === "" ? [] : part.split(":").map((h) => (/^[0-9a-f]{1,4}$/i.test(h) ? parseInt(h, 16) : NaN));
  const head = hex(halves[0]);
  const rest = halves.length === 2 ? hex(halves[1]) : [];
  if ([...head, ...rest].some(Number.isNaN)) return null;
  const count = head.length + rest.length + tail.length;
  if (halves.length === 1) return count === 8 ? [...head, ...tail] : null;
  if (count > 7) return null;
  return [...head, ...new Array(8 - count).fill(0), ...rest, ...tail];
}

function blockedV6(h: number[]): boolean {
  const embeddedV4 = [h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff];
  const firstFiveZero = h.slice(0, 5).every((x) => x === 0);
  if (h.every((x) => x === 0)) return true; // ::
  if (firstFiveZero && h[5] === 0xffff) return blockedV4(embeddedV4); // ::ffff:a.b.c.d
  if (firstFiveZero && h[5] === 0) return true; // ::1 and IPv4-compatible ::a.b.c.d (deprecated)
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return blockedV4(embeddedV4); // NAT64
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return blockedV4(v4);
  if (!ip.includes(":")) return true;
  const v6 = parseIPv6(ip);
  return v6 ? blockedV6(v6) : true;
}
```


- [ ] **Step 4: Run it to verify it passes**

Run: `npm test`
Expected: PASS (all `isBlockedAddress` cases).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/fetch-meta/netguard.ts tests/netguard.test.ts
git commit -m "feat(meta): fail-closed private-address guard for outbound fetches"
```

---

### Task B2: `<head>` parser and favicon candidates

**Files:**
- Create: `supabase/functions/fetch-meta/parseHead.ts`
- Test: `tests/parseHead.test.ts`

**Interfaces:**
- Produces:
  - `extractMeta(html: string, pageUrl: string): { title: string | null; description: string | null; faviconCandidates: string[] }`
  - `iconExtension(contentType: string): string | null` (returns `png | ico | jpg | gif | webp | svg`, or `null`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { extractMeta, iconExtension } from "../supabase/functions/fetch-meta/parseHead";

const PAGE = "https://www.example.com/home/";

describe("extractMeta", () => {
  it("reads title and description, decoding entities and collapsing whitespace", () => {
    const html = `<html><HEAD><TITLE>  Tom &amp; Jerry\n  &#8211; Home </TITLE>
      <meta name="Description" content='Cats &quot;and&quot; mice'></HEAD><body><title>ignored</title>`;
    expect(extractMeta(html, PAGE)).toMatchObject({ title: "Tom & Jerry – Home", description: 'Cats "and" mice' });
  });

  it("falls back to Open Graph tags", () => {
    const html = `<head><meta property="og:title" content="OG T"><meta property=og:description content=OGD></head>`;
    expect(extractMeta(html, PAGE)).toMatchObject({ title: "OG T", description: "OGD" });
  });

  it("caps title at 200 and description at 500 characters", () => {
    const html = `<head><title>${"t".repeat(10_000)}</title><meta name="description" content="${"d".repeat(900)}"></head>`;
    const m = extractMeta(html, PAGE);
    expect(m.title).toHaveLength(200);
    expect(m.description).toHaveLength(500);
  });

  it("returns nulls for empty or missing tags and survives a missing </head>", () => {
    expect(extractMeta(`<head><title>   </title><meta name="description" content="">`, PAGE)).toMatchObject({
      title: null,
      description: null,
    });
    expect(() => extractMeta(`<head><meta name="description" content="unterminated`, PAGE)).not.toThrow();
  });

  it("orders favicon candidates: png/svg icon, other icon, apple-touch-icon, then /favicon.ico", () => {
    const html = `<head>
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="shortcut icon" href="/old.ico">
      <link rel="icon" type="image/svg+xml" href="//cdn.example.com/i.svg">
      <link rel="icon" href="data:image/png;base64,AAAA">
    </head>`;
    expect(extractMeta(html, PAGE).faviconCandidates).toEqual([
      "https://cdn.example.com/i.svg",
      "https://www.example.com/old.ico",
      "https://www.example.com/apple.png",
      "https://www.example.com/favicon.ico",
    ]);
  });

  it("resolves relative icons against the final page URL and dedupes the fallback", () => {
    const html = `<head><link rel=icon href="favicon.ico"></head>`;
    expect(extractMeta(html, "https://example.com/").faviconCandidates).toEqual(["https://example.com/favicon.ico"]);
  });
});

describe("iconExtension", () => {
  it("maps allowed image types and rejects others", () => {
    expect(iconExtension("image/png")).toBe("png");
    expect(iconExtension("image/x-icon")).toBe("ico");
    expect(iconExtension("image/vnd.microsoft.icon")).toBe("ico");
    expect(iconExtension("image/svg+xml; charset=utf-8")).toBe("svg");
    expect(iconExtension("image/jpeg")).toBe("jpg");
    expect(iconExtension("text/html")).toBeNull();
    expect(iconExtension("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Implement `supabase/functions/fetch-meta/parseHead.ts`**

```ts
// Dependency-free <head> reader (ADR 0003): title/description with Open
// Graph fallbacks, and ordered favicon candidates. Output is plain text.

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 500;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

function clean(raw: string | undefined, max: number): string | null {
  if (raw === undefined) return null;
  const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const inner = tag.replace(/^<\s*\w+/, "").replace(/\/?>$/, "");
  for (const m of inner.matchAll(ATTR)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

function headOf(html: string): string {
  const end = html.search(/<\/head\s*>/i);
  return end === -1 ? html : html.slice(0, end);
}

export function extractMeta(html: string, pageUrl: string) {
  const head = headOf(html);
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const metaValue = (key: "name" | "property", value: string) =>
    metas.find((a) => a[key]?.toLowerCase() === value)?.content;

  const title =
    clean(head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1], TITLE_MAX) ??
    clean(metaValue("property", "og:title"), TITLE_MAX);
  const description =
    clean(metaValue("name", "description"), DESCRIPTION_MAX) ??
    clean(metaValue("property", "og:description"), DESCRIPTION_MAX);

  const ranked: { href: string; rank: number; order: number }[] = [];
  [...head.matchAll(/<link\b[^>]*>/gi)].forEach((m, order) => {
    const a = attrs(m[0]);
    const rel = (a.rel ?? "").toLowerCase().split(/\s+/);
    if (!a.href) return;
    let rank: number;
    if (rel.includes("icon")) {
      const type = (a.type ?? "").toLowerCase();
      rank = /png|svg/.test(type) || /\.(png|svg)(\?|$)/i.test(a.href) ? 0 : 1;
    } else if (rel.includes("apple-touch-icon")) rank = 2;
    else return;
    ranked.push({ href: decodeEntities(a.href), rank, order });
  });

  const candidates: string[] = [];
  const add = (href: string) => {
    try {
      const url = new URL(href, pageUrl);
      if ((url.protocol === "http:" || url.protocol === "https:") && !candidates.includes(url.href)) {
        candidates.push(url.href);
      }
    } catch {
      // ignore unparseable hrefs
    }
  };
  ranked.sort((x, y) => x.rank - y.rank || x.order - y.order).forEach((c) => add(c.href));
  add("/favicon.ico");

  return { title, description, faviconCandidates: candidates };
}

const ICON_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export function iconExtension(contentType: string): string | null {
  return ICON_TYPES[contentType.split(";")[0].trim().toLowerCase()] ?? null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/fetch-meta/parseHead.ts tests/parseHead.test.ts
git commit -m "feat(meta): dependency-free head parser and favicon candidates"
```

---

### Task B3: `safeFetch`

**Files:**
- Create: `supabase/functions/fetch-meta/safeFetch.ts`
- Test: `tests/safeFetch.test.ts`

**Interfaces:**
- Consumes: `isBlockedAddress` (B1).
- Produces:
  - `interface NetDeps { resolve(host: string): Promise<string[]>; fetch(url: string, init: RequestInit): Promise<Response> }`
  - `class FetchBlocked extends Error`
  - `META_LIMITS = { requestTimeoutMs: 8000, maxRedirects: 3, htmlMaxBytes: 524288, iconMaxBytes: 102400, perDomainMs: 20000, runBudgetMs: 60000, maxDomainsPerRun: 5, iconCandidates: 2 }`
  - `safeFetch(url: string, deps: NetDeps, opts: { accept: string; maxBytes: number; overflow: "truncate" | "error"; stopAtHeadEnd?: boolean; signal?: AbortSignal }): Promise<{ url: string; status: number; contentType: string; body: Uint8Array }>`
  - `fetchSite(domain: string, deps: NetDeps, signal?: AbortSignal)`, with the same return type (https first, then http on a non-`FetchBlocked` failure).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { FetchBlocked, fetchSite, META_LIMITS, safeFetch, type NetDeps } from "../supabase/functions/fetch-meta/safeFetch";

function deps(routes: Record<string, () => Response>, dns: Record<string, string[]> = {}) {
  const calls: string[] = [];
  const net: NetDeps = {
    resolve: async (host) => dns[host] ?? ["93.184.216.34"],
    fetch: async (url) => {
      calls.push(url);
      const r = routes[url];
      if (!r) throw new TypeError(`network error for ${url}`);
      return r();
    },
  };
  return { net, calls };
}
const html = (body: string, status = 200) => () =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const redirect = (to: string) => () => new Response(null, { status: 301, headers: { location: to } });
const HTML_OPTS = { accept: "text/html", maxBytes: META_LIMITS.htmlMaxBytes, overflow: "truncate" as const, stopAtHeadEnd: true };

describe("safeFetch", () => {
  it("refuses a host that resolves to a private address, without fetching", async () => {
    const { net, calls } = deps({}, { "evil.test": ["10.0.0.5"] });
    await expect(safeFetch("https://evil.test/", net, HTML_OPTS)).rejects.toBeInstanceOf(FetchBlocked);
    expect(calls).toEqual([]);
  });

  it("re-checks every redirect hop: a redirect to 127.0.0.1 is refused", async () => {
    const { net, calls } = deps({ "https://a.test/": redirect("http://127.0.0.1/admin") });
    await expect(safeFetch("https://a.test/", net, HTML_OPTS)).rejects.toBeInstanceOf(FetchBlocked);
    expect(calls).toEqual(["https://a.test/"]);
  });

  it("refuses non-80/443 ports and non-http schemes", async () => {
    const { net, calls } = deps({ "https://a.test/": redirect("https://a.test:8080/") });
    await expect(safeFetch("https://a.test/", net, HTML_OPTS)).rejects.toBeInstanceOf(FetchBlocked);
    await expect(safeFetch("ftp://a.test/", net, HTML_OPTS)).rejects.toBeInstanceOf(FetchBlocked);
    expect(calls).toEqual(["https://a.test/"]);
  });

  it("gives up after 3 redirects", async () => {
    const { net } = deps({
      "https://a.test/": redirect("/1"),
      "https://a.test/1": redirect("/2"),
      "https://a.test/2": redirect("/3"),
      "https://a.test/3": redirect("/4"),
    });
    await expect(safeFetch("https://a.test/", net, HTML_OPTS)).rejects.toThrow(/too many redirects/);
  });

  it("follows up to 3 redirects and reports the final URL", async () => {
    const { net } = deps({ "https://a.test/": redirect("https://www.a.test/"), "https://www.a.test/": html("<head></head>") });
    const res = await safeFetch("https://a.test/", net, HTML_OPTS);
    expect(res.url).toBe("https://www.a.test/");
    expect(new TextDecoder().decode(res.body)).toBe("<head></head>");
  });

  it("stops reading HTML at </head> and truncates at the byte cap", async () => {
    const stream = () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("<head><title>x</title></HEAD>"));
            c.enqueue(new TextEncoder().encode("<body>" + "y".repeat(1_000_000)));
            c.close();
          },
        }),
        { headers: { "content-type": "text/html" } },
      );
    const { net } = deps({ "https://a.test/": stream });
    const res = await safeFetch("https://a.test/", net, HTML_OPTS);
    expect(res.body.length).toBeLessThan(META_LIMITS.htmlMaxBytes);
    const big = deps({ "https://b.test/": html("z".repeat(META_LIMITS.htmlMaxBytes + 10)) });
    const res2 = await safeFetch("https://b.test/", big.net, HTML_OPTS);
    expect(res2.body.length).toBe(META_LIMITS.htmlMaxBytes);
  });

  it("errors when an icon exceeds 100 KB", async () => {
    const big = () => new Response(new Uint8Array(META_LIMITS.iconMaxBytes + 1), { headers: { "content-type": "image/png" } });
    const { net } = deps({ "https://a.test/f.png": big });
    await expect(
      safeFetch("https://a.test/f.png", net, { accept: "image/*", maxBytes: META_LIMITS.iconMaxBytes, overflow: "error" }),
    ).rejects.toThrow(/too large/);
  });

  it("aborts every request through the shared per-domain deadline", async () => {
    const slow: NetDeps = {
      resolve: async () => ["93.184.216.34"],
      fetch: (_url, init) =>
        new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    };
    const deadline = AbortSignal.timeout(50);
    const started = Date.now();
    await expect(safeFetch("https://slow.test/", slow, { ...HTML_OPTS, signal: deadline })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("fetchSite", () => {
  it("falls back to http when https fails at the network level", async () => {
    const { net, calls } = deps({ "http://a.test/": html("<head></head>") });
    const res = await fetchSite("a.test", net);
    expect(res.url).toBe("http://a.test/");
    expect(calls).toEqual(["https://a.test/", "http://a.test/"]);
  });

  it("does not fall back when the target is blocked", async () => {
    const { net, calls } = deps({}, { "a.test": ["192.168.1.1"] });
    await expect(fetchSite("a.test", net)).rejects.toBeInstanceOf(FetchBlocked);
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Implement `supabase/functions/fetch-meta/safeFetch.ts`**

```ts
// The only way fetch-meta reaches the internet (ADR 0003): scheme/port
// allowlist, address check on every hop, manual redirects (≤3), per-request
// timeout plus a shared per-domain deadline, and byte caps. I/O is injected.

import { isBlockedAddress } from "./netguard.ts";

export const META_LIMITS = {
  requestTimeoutMs: 8_000,
  maxRedirects: 3,
  htmlMaxBytes: 512 * 1024,
  iconMaxBytes: 100 * 1024,
  perDomainMs: 20_000,
  runBudgetMs: 60_000,
  maxDomainsPerRun: 5,
  iconCandidates: 2,
} as const;

const USER_AGENT = "DRCheckerBot/1.0 (+https://dr-bulkchecker.netlify.app)";

export interface NetDeps {
  resolve(host: string): Promise<string[]>;
  fetch(url: string, init: RequestInit): Promise<Response>;
}

export class FetchBlocked extends Error {}

export interface SafeFetchOpts {
  accept: string;
  maxBytes: number;
  overflow: "truncate" | "error";
  stopAtHeadEnd?: boolean;
  signal?: AbortSignal;
}

export interface FetchedBody {
  url: string;
  status: number;
  contentType: string;
  body: Uint8Array;
}

async function checkUrl(url: URL, deps: NetDeps): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchBlocked(`scheme ${url.protocol}`);
  if (url.port !== "" && url.port !== "80" && url.port !== "443") throw new FetchBlocked(`port ${url.port}`);
  if (url.username || url.password) throw new FetchBlocked("credentials in URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = /^[\d.]+$/.test(host) || host.includes(":") ? [host] : await deps.resolve(host);
  if (addresses.length === 0) throw new Error(`DNS: no address for ${host}`);
  const blocked = addresses.find(isBlockedAddress);
  if (blocked) throw new FetchBlocked(`blocked address ${blocked}`);
}

async function readCapped(res: Response, opts: SafeFetchOpts): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > opts.maxBytes) {
        if (opts.overflow === "error") throw new Error(`too large (> ${opts.maxBytes} bytes)`);
        chunks.push(value.slice(0, opts.maxBytes - total));
        total = opts.maxBytes;
        break;
      }
      chunks.push(value);
      total += value.length;
      if (opts.stopAtHeadEnd) {
        text += decoder.decode(value, { stream: true });
        if (/<\/head\s*>/i.test(text)) break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export async function safeFetch(start: string, deps: NetDeps, opts: SafeFetchOpts): Promise<FetchedBody> {
  let url: URL;
  try {
    url = new URL(start);
  } catch {
    throw new FetchBlocked(`invalid URL ${start}`);
  }
  for (let hop = 0; ; hop++) {
    await checkUrl(url, deps);
    const timeout = AbortSignal.timeout(META_LIMITS.requestTimeoutMs);
    const res = await deps.fetch(url.href, {
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT, Accept: opts.accept },
      signal: opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout,
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      if (hop >= META_LIMITS.maxRedirects) throw new FetchBlocked("too many redirects");
      url = new URL(location, url);
      continue;
    }
    return {
      url: url.href,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      body: await readCapped(res, opts),
    };
  }
}

export async function fetchSite(domain: string, deps: NetDeps, signal?: AbortSignal): Promise<FetchedBody> {
  const opts: SafeFetchOpts = {
    accept: "text/html,application/xhtml+xml",
    maxBytes: META_LIMITS.htmlMaxBytes,
    overflow: "truncate",
    stopAtHeadEnd: true,
    signal,
  };
  try {
    return await safeFetch(`https://${domain}/`, deps, opts);
  } catch (err) {
    if (err instanceof FetchBlocked || signal?.aborted) throw err;
    return await safeFetch(`http://${domain}/`, deps, opts);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test && npm run typecheck`
Expected: PASS. `AbortSignal.any` is available in Node ≥ 20.3 and Deno.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/fetch-meta/safeFetch.ts tests/safeFetch.test.ts
git commit -m "feat(meta): safeFetch with per-hop address checks, redirect/size/time limits"
```

---

### Task B4: `domain_meta` migration

**Files:**
- Create: `supabase/migrations/20261015000000_domain_meta.sql`
- Modify: `supabase/schema.sql` (same objects; in the "Worker triggering" section)
- Modify (generated): `supabase/functions/_shared/database.types.ts`

**Interfaces:**
- Produces:
  - the table `domain_meta(domain pk, title, description, favicon_path, status 'ok'|'error'|null, error, fetched_at, claimed_at, attempts)`;
  - `meta_due(text, timestamptz, timestamptz) returns boolean`;
  - `claim_meta_domains(p_limit integer) returns setof text`;
  - `kick_meta_worker() returns void`;
  - the cron job `fetch-meta`;
  - the bucket `favicons`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- ADR 0003 (Part B): site metadata. A separate fetch-meta edge function,
-- started every minute by kick_meta_worker() (Vault: worker_secret +
-- meta_worker_url), claims due domains and stores title/description and a
-- favicon in the public `favicons` bucket.
-- ============================================================================

create table if not exists public.domain_meta (
  domain       text primary key,
  title        text,
  description  text,
  favicon_path text,
  status       text check (status in ('ok', 'error')),  -- null = never fetched
  error        text,
  fetched_at   timestamptz,
  claimed_at   timestamptz,
  attempts     integer not null default 0
);
alter table public.domain_meta enable row level security;

-- One place for the cadence: never fetched, ok > 30 days, error > 7 days,
-- or claimed > 2 minutes ago and never finished. In-flight rows are not due.
create or replace function public.meta_due(p_status text, p_fetched_at timestamptz, p_claimed_at timestamptz)
returns boolean
language sql
stable
as $$
  select
    not (p_claimed_at is not null
         and p_claimed_at > coalesce(p_fetched_at, '-infinity'::timestamptz)
         and p_claimed_at > now() - interval '2 minutes')
    and (
      p_status is null
      or (p_status = 'ok' and p_fetched_at < now() - interval '30 days')
      or (p_status = 'error' and p_fetched_at < now() - interval '7 days')
      or (p_claimed_at is not null and p_claimed_at > coalesce(p_fetched_at, '-infinity'::timestamptz))
    )
$$;

create or replace function public.claim_meta_domains(p_limit integer default 1)
returns setof text
language plpgsql
as $$
begin
  -- every `ok` domain gets a meta row so it can be locked and claimed
  insert into public.domain_meta (domain)
  select d.domain from public.domains d
  where d.status = 'ok'
    and not exists (select 1 from public.domain_meta x where x.domain = d.domain)
  on conflict (domain) do nothing;

  return query
  update public.domain_meta m
  set claimed_at = now(), attempts = m.attempts + 1
  where m.domain in (
    select x.domain
    from public.domain_meta x
    join public.domains d on d.domain = x.domain and d.status = 'ok'
    where public.meta_due(x.status, x.fetched_at, x.claimed_at)
    order by x.fetched_at nulls first, x.domain
    limit p_limit
    for update of x skip locked
  )
  returning m.domain;
end;
$$;

create or replace function public.kick_meta_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_url    text;
begin
  if not exists (
    select 1 from public.domains d
    left join public.domain_meta x on x.domain = d.domain
    where d.status = 'ok' and public.meta_due(x.status, x.fetched_at, x.claimed_at)
  ) then
    return;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'worker_secret';
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'meta_worker_url';
  if v_secret is null or v_url is null then
    raise warning 'kick_meta_worker: vault entries worker_secret/meta_worker_url missing; worker not started';
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    body := '{}'::jsonb,
    -- run budget (60 s) + one domain's hard deadline (20 s), with slack
    timeout_milliseconds := 120000
  );
end;
$$;

revoke execute on function public.meta_due(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.claim_meta_domains(integer) from public, anon, authenticated;
revoke execute on function public.kick_meta_worker() from public, anon, authenticated;

-- public-read bucket; size and type limits are enforced server-side too
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('favicons', 'favicons', true, 102400,
        array['image/png','image/x-icon','image/vnd.microsoft.icon','image/jpeg','image/gif','image/webp','image/svg+xml'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

select cron.unschedule(jobid) from cron.job where jobname = 'fetch-meta';
select cron.schedule('fetch-meta', '* * * * *', $$select public.kick_meta_worker()$$);
```

- [ ] **Step 2: Mirror it in `supabase/schema.sql`**

Put the table and its RLS line, the three functions, the revokes and the bucket insert in the "Worker triggering (ADR 0002)" section, under the heading `-- Site metadata (ADR 0003)`. Put the two `fetch-meta` cron lines next to the `process-queue-backstop` cron block at the end of the file.

- [ ] **Step 3: Parse-check, apply, regenerate types**

```bash
node /private/tmp/claude-501/-Users-brahim-Work-projects-dr-checker/e522dd7c-e050-4227-8a3a-338bb3ca45f5/scratchpad/pgparse/check.mjs supabase/schema.sql supabase/migrations/20261015000000_domain_meta.sql
export PATH=$HOME/.nvm/versions/node/v24.16.0/bin:$PATH
export SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env | cut -d= -f2- | tr -d '"'"'"' \r')
echo y | npx -y supabase@2.109.0 db push
npm run gen:types && grep -c "domain_meta\|claim_meta_domains" supabase/functions/_shared/database.types.ts
```

Expected: `OK` for both files; the push applies only `20261015000000`; the count is ≥ 2.

Until the user provisions `meta_worker_url` (Task B6), the cron job only logs the Vault warning, which is harmless.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261015000000_domain_meta.sql supabase/schema.sql supabase/functions/_shared/database.types.ts
git commit -m "feat(db): domain_meta, meta_due/claim_meta_domains, kick_meta_worker, favicons bucket"
```

---

### Task B5: The `fetch-meta` function and its limit invariants

**Files:**
- Move: `supabase/functions/process-queue/auth.ts` → `supabase/functions/_shared/auth.ts`. Update the imports in `process-queue/index.ts` (`../_shared/auth.ts`) and `tests/workerAuth.test.ts` (`../supabase/functions/_shared/auth`).
- Create: `supabase/functions/fetch-meta/index.ts`
- Test: `tests/metaLimits.test.ts`

**Interfaces:**
- Consumes:
  - `checkWorkerSecret`;
  - `safeFetch`, `fetchSite`, `FetchBlocked`, `META_LIMITS`, `NetDeps` (B3);
  - `extractMeta`, `iconExtension` (B2);
  - the RPC `claim_meta_domains` (B4);
  - the `favicons` bucket and the `domain_meta` table.
- Produces: the HTTP contract, `401`/`500` (auth), else `200 {"processed": N, "ok": n, "error": m}`.

- [ ] **Step 1: Write the failing limits test**

`tests/metaLimits.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { META_LIMITS } from "../supabase/functions/fetch-meta/safeFetch";
import { EDGE_WALL_CLOCK_MS } from "../supabase/functions/process-queue/drain";

describe("fetch-meta time limits", () => {
  it("lets the last domain finish before the edge wall clock kills the run", () => {
    expect(META_LIMITS.runBudgetMs + META_LIMITS.perDomainMs).toBeLessThan(EDGE_WALL_CLOCK_MS);
  });

  it("keeps the per-domain deadline above a single request timeout", () => {
    expect(META_LIMITS.perDomainMs).toBeGreaterThan(META_LIMITS.requestTimeoutMs);
  });

  it("keeps pg_net waiting longer than a whole run", () => {
    const sql = readFileSync("supabase/migrations/20261015000000_domain_meta.sql", "utf8");
    const timeout = Number(sql.match(/timeout_milliseconds := (\d+)/)?.[1]);
    expect(timeout).toBeGreaterThanOrEqual(META_LIMITS.runBudgetMs + META_LIMITS.perDomainMs);
  });
});
```

Run: `npm test`
Expected: PASS straight away. These are invariants over values chosen in B3 and B4; a failure means one of those values is wrong. Record this in the ledger as a ruling, since there is no RED step here.

- [ ] **Step 2: Move `auth.ts`**

```bash
git mv supabase/functions/process-queue/auth.ts supabase/functions/_shared/auth.ts
sed -i '' 's#from "./auth.ts"#from "../_shared/auth.ts"#' supabase/functions/process-queue/index.ts
sed -i '' 's#process-queue/auth"#_shared/auth"#' tests/workerAuth.test.ts
npm test && deno check supabase/functions/process-queue/index.ts; rm -f deno.lock
```

Expected: PASS.

- [ ] **Step 3: Write `supabase/functions/fetch-meta/index.ts`**

```ts
// Invoked (ADR 0003) by public.kick_meta_worker() via pg_net from the
// `fetch-meta` cron job (every minute, only when domains are due). Every call
// must carry `x-worker-secret`. Claims one due domain at a time (up to 5 per
// run, 60 s budget, 20 s hard deadline per domain), fetches its homepage
// through safeFetch, stores title/description and a favicon.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Database } from "../_shared/database.types.ts";
import { checkWorkerSecret } from "../_shared/auth.ts";
import { extractMeta, iconExtension } from "./parseHead.ts";
import { FetchBlocked, fetchSite, META_LIMITS, safeFetch, type NetDeps } from "./safeFetch.ts";

const supabase = createClient<Database>(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const WORKER_SECRET = Deno.env.get("WORKER_SECRET");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const net: NetDeps = {
  resolve: async (host) => {
    const [a, aaaa] = await Promise.all([
      Deno.resolveDns(host, "A").catch(() => [] as string[]),
      Deno.resolveDns(host, "AAAA").catch(() => [] as string[]),
    ]);
    return [...a, ...aaaa];
  },
  fetch: (url, init) => fetch(url, init),
};

async function storeFavicon(domain: string, candidates: string[], signal: AbortSignal): Promise<string | null> {
  for (const href of candidates.slice(0, META_LIMITS.iconCandidates)) {
    try {
      const icon = await safeFetch(href, net, {
        accept: "image/*",
        maxBytes: META_LIMITS.iconMaxBytes,
        overflow: "error",
        signal,
      });
      const ext = iconExtension(icon.contentType);
      if (icon.status >= 400 || !ext || icon.body.length === 0) continue;
      const path = `${domain}.${ext}`;
      const { error } = await supabase.storage
        .from("favicons")
        .upload(path, icon.body, { upsert: true, contentType: icon.contentType.split(";")[0].trim() });
      if (!error) return path;
      console.error("favicon upload failed", domain, error.message);
    } catch {
      // try the next candidate
    }
  }
  return null;
}

async function processDomain(domain: string): Promise<"ok" | "error"> {
  const deadline = AbortSignal.timeout(META_LIMITS.perDomainMs);
  try {
    const page = await fetchSite(domain, net, deadline);
    if (page.status >= 400) throw new Error(`HTTP ${page.status}`);
    if (!/^(text\/html|application\/xhtml\+xml)/i.test(page.contentType)) {
      throw new Error(`not HTML (${page.contentType || "no content-type"})`);
    }
    const meta = extractMeta(new TextDecoder().decode(page.body), page.url);
    const favicon_path = await storeFavicon(domain, meta.faviconCandidates, deadline);
    await supabase
      .from("domain_meta")
      .update({
        title: meta.title,
        description: meta.description,
        favicon_path,
        status: "ok",
        error: null,
        fetched_at: new Date().toISOString(),
        attempts: 0,
      })
      .eq("domain", domain);
    return "ok";
  } catch (err) {
    const reason = err instanceof FetchBlocked ? `blocked: ${err.message}` : String((err as Error)?.message ?? err);
    await supabase
      .from("domain_meta")
      .update({ status: "error", error: reason.slice(0, 200), fetched_at: new Date().toISOString() })
      .eq("domain", domain);
    return "error";
  }
}

Deno.serve(async (req) => {
  const auth = checkWorkerSecret(req.headers.get("x-worker-secret"), WORKER_SECRET);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const started = Date.now();
  const counts = { processed: 0, ok: 0, error: 0 };
  while (counts.processed < META_LIMITS.maxDomainsPerRun && Date.now() - started < META_LIMITS.runBudgetMs) {
    const { data, error } = await supabase.rpc("claim_meta_domains", { p_limit: 1 });
    if (error) return json({ error: `claim failed: ${error.message}`, ...counts }, 500);
    const domain = data?.[0];
    if (!domain) break;
    counts[await processDomain(domain)]++;
    counts.processed++;
  }
  return json(counts);
});
```

- [ ] **Step 4: Type-check and run the gate**

Run: `deno check supabase/functions/fetch-meta/index.ts && deno check supabase/functions/process-queue/index.ts; rm -f deno.lock; npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions tests/metaLimits.test.ts tests/workerAuth.test.ts
git commit -m "feat(meta): fetch-meta edge function; shared auth; limit invariants"
```

---

### Task B6: Meta in the API, provisioning, docs and PR B rollout

**Files:**
- Modify: `server/api/domain/[domain].get.ts` (read `domain_meta`), `scripts/provision-worker-secret.sh` (set `meta_worker_url`), `CLAUDE.md`, `pages/docs.vue`, `.claude/settings.local.json` (allow `functions deploy fetch-meta`, via the `update-config` skill)

**Interfaces:**
- Consumes: the `domain_meta` table (B4) and the `favicons` bucket.
- Produces: `DomainView.meta` filled when a `domain_meta` row has `status = 'ok'`.

- [ ] **Step 1: Add meta to the API**

In `server/api/domain/[domain].get.ts`, before the `return`, add:

```ts
  const { data: metaRow, error: metaError } = await admin
    .from("domain_meta")
    .select("title, description, favicon_path, status")
    .eq("domain", domain)
    .maybeSingle();
  if (metaError) throw createError({ statusCode: 500, statusMessage: metaError.message });

  const supabaseUrl = useRuntimeConfig().public.supabaseUrl as string;
  const meta =
    metaRow?.status === "ok"
      ? {
          title: metaRow.title,
          description: metaRow.description,
          favicon_url: metaRow.favicon_path
            ? `${supabaseUrl}/storage/v1/object/public/favicons/${encodeURIComponent(metaRow.favicon_path)}`
            : null,
        }
      : null;
```

Then change the return to use `meta` instead of `meta: null`.

- [ ] **Step 2: The provisioning script also sets `meta_worker_url`**

In `scripts/provision-worker-secret.sh`, after `URL=…` add:

```bash
META_URL="https://${REF}.supabase.co/functions/v1/fetch-meta"
```

Inside the `do $$ … $$` SQL, after the `worker_url` block, add:

```sql
  if exists (select 1 from vault.secrets where name = 'meta_worker_url') then
    perform vault.update_secret((select id from vault.secrets where name = 'meta_worker_url'), '${META_URL}');
  else
    perform vault.create_secret('${META_URL}', 'meta_worker_url');
  end if;
```

Change the final echo to `vault entries worker_secret + worker_url + meta_worker_url set`. Run `bash -n scripts/provision-worker-secret.sh` (expected: no output).

- [ ] **Step 3: Docs**
  - **CLAUDE.md:**
    - architecture: add a `fetch-meta` paragraph covering the per-minute cron, `kick_meta_worker`, `safeFetch` rules, the `favicons` bucket and the 30/7-day cadence;
    - Key files: add `supabase/functions/fetch-meta/*` and `_shared/auth.ts`;
    - setup list: the provisioning script also sets `meta_worker_url`.
  - **`pages/docs.vue` §7:** "Domain pages also show the site's favicon, title and description, refreshed monthly."

- [ ] **Step 4: Gate, then deploy (Claude, allow rules)**

Add the rule `Bash(npx -y supabase@2.109.0 functions deploy fetch-meta --no-verify-jwt)` via the `update-config` skill. Then:

```bash
npm test && npm run typecheck && npm run build && bash -n scripts/provision-worker-secret.sh
export PATH=$HOME/.nvm/versions/node/v24.16.0/bin:$PATH
export SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env | cut -d= -f2- | tr -d '"'"'"' \r')
npx -y supabase@2.109.0 functions deploy fetch-meta --no-verify-jwt
npx -y supabase@2.109.0 functions deploy process-queue --no-verify-jwt   # picks up the moved _shared/auth.ts
git add -A server scripts CLAUDE.md pages && git commit -m "feat(meta): serve metadata on domain pages; provision meta_worker_url"
```

- [ ] **Step 5: Provision (user, sensitive)**

The user reruns the provisioning script. This also rotates `WORKER_SECRET`. That is harmless: calls between the two updates get a 401, and the crons retry within 10 s and 1 min.

- [ ] **Step 6: Verify**
  - `curl -X POST https://jwlpauxspwybjkxxujvc.supabase.co/functions/v1/fetch-meta` returns **401**.
  - Read-only SQL:
    - the `fetch-meta` cron job's command is `select public.kick_meta_worker()`, and its recent runs succeeded;
    - after about 3 minutes, `select status, count(*) from domain_meta group by status` shows `ok` (and maybe `error`) counts growing;
    - `select domain, error from domain_meta where status='error' limit 5` gives readable reasons.
  - Blocked target: confirm a recorded `blocked: …` error if any domain resolves privately. The unit tests cover the ranges.
  - **After merge** (Netlify): `/domain/python.org` shows a favicon served from `…/storage/v1/object/public/favicons/python.org.<ext>` and a "From the site" title. `curl -I` on the favicon URL returns `200` with an `image/*` content type.
  - Push `feat/domain-meta`, open the prefilled PR, and the user merges.

**Rollback:** `select cron.unschedule(jobid) from cron.job where jobname='fetch-meta';`. Pages fall back to the plain view.
