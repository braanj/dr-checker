# Domain Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the CSV-first DR checker into a lookup-first public domain directory: typed or CSV checks, a 30-day DR cache, no accounts, and live progress via Realtime broadcast.

**Architecture:** A new `domains` table is both the public directory and the cache. `POST /api/check` resolves fresh cache hits at insert time and queues the rest. The `process-queue` edge function checks the cache again, calls Ahrefs, upserts `domains`, and retries transient failures with backoff. Postgres triggers push row changes with `realtime.send()` to a public channel `batch:<uuid>`. `batches`/`urls` stay unreadable with the anon key.

**Tech Stack:** Nuxt 3 / Nitro (Netlify), Supabase Postgres + Realtime + Edge Functions (Deno), Tailwind, Vitest (new).

**Spec:** `specs/adr/0001-domain-directory.md`. Read it before starting; this plan argues from it.

## Global Constraints

- Typed input: max **100** valid domains. CSV: max **1,000** valid entries. Invalid entries don't count toward either cap.
- Typed checks with **≤ 10** valid rows render inline at `/?check=<id>`. Everything else redirects to `/results/<id>`.
- Cache TTL: `ok` **30 days**, `no_data` **7 days**. HTTP/429/network errors are never cached. DR `0` is a success.
- Retries: **3** attempts max; backoff `30s × attempts`. Stuck `processing` rows are reclaimed after **2 minutes**.
- Rate limit: **10 requests / minute / IP**, IP from `x-nf-client-connection-ip`, falling back to `getRequestIP(event, { xForwardedFor: true })`.
- `urls.source` ∈ `live | cache | stale | no_data` (nullable while pending or on a plain error).
- Normalization: full host with only a leading `www.` stripped. A host must contain a dot to be valid.
- No anon-readable tables and no anon-executable RPCs. All DB access from Nitro goes through `supabaseAdmin()` (`server/utils/supabaseAdmin.ts`).
- Shared constants and cache logic live once, in `supabase/functions/_shared/cache.ts` (dependency-free, so both Node and Deno can import it).
- Directory copy: "Checked domains are added to the public directory below."
- No Supabase CLI or Docker on the dev machine. SQL is verified by running it in the Supabase SQL editor; the edge function with `deno check`.

## Review Focus

1. **CSV exported from Excel** (UTF-8 BOM, CRLF line endings, quoted `"URL"` header). Expected: the header is detected and the BOM doesn't become a junk domain. Pinned in Task 1 (`parseCsvUrls` BOM test).
2. **The same domain several times in one check** (`a.com`, `https://www.a.com/x`). Expected: two url rows, each resolved; one Ahrefs call; the cache-hit count counts rows, not domains. Pinned in Task 1 (`planUrlRows` duplicates test) and Task 5 (worker groups by domain).
3. **Boundary counts after normalization:** 10 → inline and 11 → page; 100 typed OK and 101 rejected; 100 valid + 5 junk at cap 100 OK. Pinned in Task 1 (`buildCheckRows`/`resultsDisplay` tests).
4. **Input that is only junk, blanks or commas** (`",, \n localhost\n not a domain"`). Expected: a clear 400 "No valid domains found", no batch created, and no rate-limit slot used. Pinned in Task 1 (`buildCheckRows` throws), with the order enforced in Task 4 (validate → rate limit → write).
5. **A reclaimed row that has already used its attempts**, with and without a stale DR. Expected: no infinite requeue; it ends as `done/stale` or `error`. Pinned in Task 2 (`urlUpdateFor` attempts ≥ 3 tests).

---

## File map

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/cache.ts` (new) | TTL constants, `DomainCacheRow`, `isFresh`, `cachedUrlFields`. Pure; imported by Nitro and Deno. |
| `server/utils/checkInput.ts` (new) | Pure input handling: parse typed/CSV, normalize and cap, plan url rows from the cache, inline-or-page decision. |
| `server/utils/domain.ts` | `normalizeDomain` (now requires a dot); `generateCredentials` deleted. |
| `server/utils/createCheck.ts` (new) | DB writes for a check: cache lookup, batch and url inserts. |
| `server/utils/rateLimit.ts` (new) | `assertRateLimit(event)` via the `register_check_request` RPC. |
| `server/api/check.post.ts` (new) | HTTP entry for typed and CSV checks. Replaces `server/api/upload.post.ts` (deleted). |
| `server/api/domains.get.ts`, `status/[batchId].get.ts`, `download/[batchId].get.ts` | Read from `domains`; expose `source`/`checked_at`. |
| `supabase/functions/process-queue/outcome.ts` (new) | Pure worker decisions: classify the Ahrefs response, url update, cache write. |
| `supabase/functions/process-queue/index.ts` | Worker I/O loop using `outcome.ts` and `_shared/cache.ts`. |
| `supabase/schema.sql` | End-state schema for fresh installs. |
| `supabase/migrations/20261007000000_domain_directory.sql` (new) | Upgrade for the live project. |
| `composables/useBatchRealtime.ts` | Broadcast subscription; subscribe before the snapshot. |
| `components/CheckResults.vue` (new) | Progress, download button, results table with provenance badges. |
| `pages/results/[batchId].vue` | Thin wrapper around `CheckResults`. |
| `pages/index.vue` | Typed/CSV form, inline results, "Domain directory" table. |
| `pages/docs.vue`, `CLAUDE.md`, `README.md` | Documentation. |
| `tests/*.test.ts`, `vitest.config.ts`, `package.json` | Unit tests. |

---

### Task 1: Vitest, shared cache module, and pure input handling

**Files:**
- Modify: `package.json` (add `vitest`, `test` script)
- Create: `vitest.config.ts`
- Create: `supabase/functions/_shared/cache.ts`
- Create: `server/utils/checkInput.ts`
- Modify: `server/utils/domain.ts:6-23` (`normalizeDomain` requires a dot)
- Test: `tests/cache.test.ts`, `tests/checkInput.test.ts`

**Interfaces:**
- Consumes: `normalizeDomain(input: string): string | null` from `server/utils/domain.ts`.
- Produces:
  - `_shared/cache.ts`: `CACHE_TTL_DAYS = 30`, `NO_DATA_TTL_DAYS = 7`, `NO_DATA_MESSAGE = "No DR data from Ahrefs"`, `type DomainStatus = "ok" | "no_data"`, `interface DomainCacheRow { domain: string; dr: number | null; status: DomainStatus; checked_at: string }`, `isFresh(row: Pick<DomainCacheRow, "status" | "checked_at">, now: Date): boolean`, `cachedUrlFields(hit: DomainCacheRow): CachedUrlFields`.
  - `checkInput.ts`: `TYPED_MAX = 100`, `CSV_MAX = 1000`, `INLINE_MAX = 10`, `type CheckSource = "typed" | "csv"`, `class CheckInputError extends Error`, `interface CheckRow { original_url: string; domain: string }`, `interface PlannedUrl extends CheckRow { status: "pending" | "done" | "error"; dr: number | null; source: "cache" | "no_data" | null; checked_at: string | null; error_message: string | null }`, `parseDomainList(text: string): string[]`, `parseCsvUrls(text: string): string[]`, `buildCheckRows(raw: string[], max: number): { rows: CheckRow[]; skipped: number }`, `planUrlRows(rows: CheckRow[], cache: DomainCacheRow[], now: Date): { planned: PlannedUrl[]; resolved: number }`, `resultsDisplay(source: CheckSource, total: number): "inline" | "page"`.

- [ ] **Step 1: Install Vitest and add config**

```bash
npm install -D vitest@^3
npm pkg set scripts.test="vitest run"
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 2: Write the failing cache tests**

Create `tests/cache.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cachedUrlFields, isFresh, NO_DATA_MESSAGE } from "../supabase/functions/_shared/cache";

const now = new Date("2026-10-07T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe("isFresh", () => {
  it("keeps ok rows fresh for under 30 days", () => {
    expect(isFresh({ status: "ok", checked_at: daysAgo(29) }, now)).toBe(true);
    expect(isFresh({ status: "ok", checked_at: daysAgo(30) }, now)).toBe(false);
  });

  it("keeps no_data rows fresh for under 7 days", () => {
    expect(isFresh({ status: "no_data", checked_at: daysAgo(6) }, now)).toBe(true);
    expect(isFresh({ status: "no_data", checked_at: daysAgo(7) }, now)).toBe(false);
  });
});

describe("cachedUrlFields", () => {
  it("maps an ok row to done/cache, including DR 0", () => {
    expect(
      cachedUrlFields({ domain: "a.com", dr: 0, status: "ok", checked_at: daysAgo(1) }),
    ).toEqual({ status: "done", dr: 0, source: "cache", checked_at: daysAgo(1), error_message: null });
  });

  it("maps a no_data row to error/no_data", () => {
    expect(
      cachedUrlFields({ domain: "a.com", dr: null, status: "no_data", checked_at: daysAgo(1) }),
    ).toEqual({
      status: "error",
      dr: null,
      source: "no_data",
      checked_at: daysAgo(1),
      error_message: NO_DATA_MESSAGE,
    });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test`
Expected: FAIL, because `supabase/functions/_shared/cache` cannot be resolved.

- [ ] **Step 4: Implement `supabase/functions/_shared/cache.ts`**

```ts
// Cache rules shared by the Nitro server (server/utils/checkInput.ts) and
// the process-queue edge function. Keep this file dependency-free so both
// Node and Deno can import it.

export const CACHE_TTL_DAYS = 30;
export const NO_DATA_TTL_DAYS = 7;
export const NO_DATA_MESSAGE = "No DR data from Ahrefs";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DomainStatus = "ok" | "no_data";

export interface DomainCacheRow {
  domain: string;
  dr: number | null;
  status: DomainStatus;
  checked_at: string;
}

export interface CachedUrlFields {
  status: "done" | "error";
  dr: number | null;
  source: "cache" | "no_data";
  checked_at: string;
  error_message: string | null;
}

export function isFresh(row: Pick<DomainCacheRow, "status" | "checked_at">, now: Date): boolean {
  const ttlDays = row.status === "ok" ? CACHE_TTL_DAYS : NO_DATA_TTL_DAYS;
  return now.getTime() - new Date(row.checked_at).getTime() < ttlDays * DAY_MS;
}

// The url-row fields for a check answered from a fresh `domains` row.
export function cachedUrlFields(hit: DomainCacheRow): CachedUrlFields {
  if (hit.status === "ok") {
    return { status: "done", dr: hit.dr, source: "cache", checked_at: hit.checked_at, error_message: null };
  }
  return {
    status: "error",
    dr: null,
    source: "no_data",
    checked_at: hit.checked_at,
    error_message: NO_DATA_MESSAGE,
  };
}
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the failing input tests**

Create `tests/checkInput.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeDomain } from "../server/utils/domain";
import {
  buildCheckRows,
  CheckInputError,
  parseCsvUrls,
  parseDomainList,
  planUrlRows,
  resultsDisplay,
} from "../server/utils/checkInput";
import type { DomainCacheRow } from "../supabase/functions/_shared/cache";

const now = new Date("2026-10-07T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const domainsN = (n: number) => Array.from({ length: n }, (_, i) => `site${i}.com`);

describe("normalizeDomain", () => {
  it("strips scheme, www, path, query and port, and lowercases", () => {
    expect(normalizeDomain("https://www.Example.com/page?x=1")).toBe("example.com");
    expect(normalizeDomain("example.com:8080")).toBe("example.com");
  });

  it("keeps subdomains other than www", () => {
    expect(normalizeDomain("blog.example.com")).toBe("blog.example.com");
  });

  it("rejects hosts without a dot and unparseable input", () => {
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("parseDomainList", () => {
  it("splits on newlines and commas and drops blanks", () => {
    expect(parseDomainList("a.com, b.com\nc.com\r\n\n,,")).toEqual(["a.com", "b.com", "c.com"]);
  });
});

describe("parseCsvUrls", () => {
  it("handles an Excel export: BOM, CRLF and a quoted URL header", () => {
    const csv = '﻿"URL",notes\r\n"https://a.com/x",hi\r\nb.com,\r\n';
    expect(parseCsvUrls(csv)).toEqual(["https://a.com/x", "b.com"]);
  });

  it("treats a headerless file as all data, first column only", () => {
    expect(parseCsvUrls("a.com,foo\nb.com")).toEqual(["a.com", "b.com"]);
  });

  it("does not let a BOM become part of the first domain", () => {
    expect(parseCsvUrls("﻿a.com\nb.com")).toEqual(["a.com", "b.com"]);
  });
});

describe("buildCheckRows", () => {
  it("normalizes, keeps duplicates as separate rows, and counts skipped", () => {
    const { rows, skipped } = buildCheckRows(["a.com", "https://www.a.com/x", "localhost"], 100);
    expect(rows).toEqual([
      { original_url: "a.com", domain: "a.com" },
      { original_url: "https://www.a.com/x", domain: "a.com" },
    ]);
    expect(skipped).toBe(1);
  });

  it("throws when nothing valid remains", () => {
    expect(() => buildCheckRows(parseDomainList(",, \n localhost\n not a domain"), 100)).toThrow(
      CheckInputError,
    );
    expect(() => buildCheckRows([], 100)).toThrow("No valid domains found");
  });

  it("enforces the cap on valid rows only", () => {
    expect(buildCheckRows(domainsN(100), 100).rows).toHaveLength(100);
    expect(buildCheckRows([...domainsN(100), "junk", "localhost"], 100).skipped).toBe(2);
    expect(() => buildCheckRows(domainsN(101), 100)).toThrow("Max 100 domains per check");
  });
});

describe("planUrlRows", () => {
  const cache: DomainCacheRow[] = [
    { domain: "fresh.com", dr: 55, status: "ok", checked_at: daysAgo(3) },
    { domain: "zero.com", dr: 0, status: "ok", checked_at: daysAgo(3) },
    { domain: "stale.com", dr: 40, status: "ok", checked_at: daysAgo(31) },
    { domain: "nodata.com", dr: null, status: "no_data", checked_at: daysAgo(2) },
    { domain: "oldnodata.com", dr: null, status: "no_data", checked_at: daysAgo(8) },
  ];
  const row = (domain: string) => ({ original_url: domain, domain });

  it("resolves fresh hits and queues stale, expired and unknown domains", () => {
    const { planned, resolved } = planUrlRows(
      ["fresh.com", "zero.com", "stale.com", "nodata.com", "oldnodata.com", "new.com"].map(row),
      cache,
      now,
    );
    expect(planned.map((p) => [p.domain, p.status, p.source, p.dr])).toEqual([
      ["fresh.com", "done", "cache", 55],
      ["zero.com", "done", "cache", 0],
      ["stale.com", "pending", null, null],
      ["nodata.com", "error", "no_data", null],
      ["oldnodata.com", "pending", null, null],
      ["new.com", "pending", null, null],
    ]);
    expect(resolved).toBe(3);
  });

  it("resolves every row of a duplicated domain and counts rows, not domains", () => {
    const { planned, resolved } = planUrlRows(
      [{ original_url: "fresh.com", domain: "fresh.com" }, { original_url: "https://www.fresh.com/x", domain: "fresh.com" }],
      cache,
      now,
    );
    expect(planned.every((p) => p.status === "done")).toBe(true);
    expect(resolved).toBe(2);
  });
});

describe("resultsDisplay", () => {
  it("shows typed checks of up to 10 rows inline, everything else on a page", () => {
    expect(resultsDisplay("typed", 10)).toBe("inline");
    expect(resultsDisplay("typed", 11)).toBe("page");
    expect(resultsDisplay("csv", 1)).toBe("page");
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm test`
Expected: FAIL, because `server/utils/checkInput` cannot be resolved (and the `localhost` normalize test fails).

- [ ] **Step 8: Require a dot in `normalizeDomain`**

In `server/utils/domain.ts`, replace the `try` block body of `normalizeDomain`:

```ts
  try {
    const url = new URL(value);
    let host = url.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    // "localhost", bare words etc. can't have a DR — require at least one dot.
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
```

Also update the doc comment above it to say: only a leading `www.` is stripped (subdomains are kept), and hosts without a dot are rejected.

- [ ] **Step 9: Implement `server/utils/checkInput.ts`**

```ts
// Pure input handling for POST /api/check: parsing typed lists and CSVs,
// normalizing to domains, enforcing caps, and deciding which rows the
// `domains` cache can answer at insert time. No I/O here — the writes
// live in createCheck.ts.

import { normalizeDomain } from "./domain";
import { cachedUrlFields, isFresh, type DomainCacheRow } from "../../supabase/functions/_shared/cache";

export const TYPED_MAX = 100;
export const CSV_MAX = 1000;
export const INLINE_MAX = 10;

export type CheckSource = "typed" | "csv";

export class CheckInputError extends Error {}

export interface CheckRow {
  original_url: string;
  domain: string;
}

export interface PlannedUrl extends CheckRow {
  status: "pending" | "done" | "error";
  dr: number | null;
  source: "cache" | "no_data" | null;
  checked_at: string | null;
  error_message: string | null;
}

export function parseDomainList(text: string): string[] {
  return text
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseCsvUrls(text: string): string[] {
  const lines = text
    .replace(/^﻿/, "") // Excel's UTF-8 BOM would otherwise break header detection
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  // If the first cell is "url" (optionally quoted), treat it as a header.
  const looksLikeHeader = /^["']?url["']?$/i.test(lines[0].split(",")[0].trim());
  const dataLines = looksLikeHeader ? lines.slice(1) : lines;

  return dataLines
    .map((line) => line.split(",")[0].trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

// Normalizes every entry and enforces `max` on the *valid* rows only.
// Duplicates are kept: each submitted line gets its own result row.
export function buildCheckRows(raw: string[], max: number): { rows: CheckRow[]; skipped: number } {
  const rows = raw
    .map((original_url) => ({ original_url, domain: normalizeDomain(original_url) }))
    .filter((r): r is CheckRow => !!r.domain);

  if (rows.length === 0) throw new CheckInputError("No valid domains found");
  if (rows.length > max) {
    throw new CheckInputError(`Max ${max} domains per check (got ${rows.length})`);
  }

  return { rows, skipped: raw.length - rows.length };
}

export function planUrlRows(
  rows: CheckRow[],
  cache: DomainCacheRow[],
  now: Date,
): { planned: PlannedUrl[]; resolved: number } {
  const fresh = new Map(cache.filter((c) => isFresh(c, now)).map((c) => [c.domain, c]));
  let resolved = 0;

  const planned = rows.map((row): PlannedUrl => {
    const hit = fresh.get(row.domain);
    if (!hit) {
      return { ...row, status: "pending", dr: null, source: null, checked_at: null, error_message: null };
    }
    resolved++;
    return { ...row, ...cachedUrlFields(hit) };
  });

  return { planned, resolved };
}

export function resultsDisplay(source: CheckSource, total: number): "inline" | "page" {
  return source === "typed" && total <= INLINE_MAX ? "inline" : "page";
}
```

- [ ] **Step 10: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS (all tests in `cache.test.ts` and `checkInput.test.ts`).

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json vitest.config.ts supabase/functions/_shared/cache.ts server/utils/checkInput.ts server/utils/domain.ts tests/
git commit -m "feat(check): add pure input parsing and cache planning with vitest"
```

---

### Task 2: Pure worker decisions (`outcome.ts`)

**Files:**
- Create: `supabase/functions/process-queue/outcome.ts`
- Test: `tests/outcome.test.ts`

**Interfaces:**
- Consumes: `DomainCacheRow`, `DomainStatus`, `NO_DATA_MESSAGE` from `supabase/functions/_shared/cache.ts` (Task 1).
- Produces: `MAX_ATTEMPTS = 3`, `BACKOFF_SECONDS = 30`, `type AhrefsResult = { kind: "ok"; dr: number } | { kind: "no_data" } | { kind: "transient"; error: string }`, `classifyAhrefsResponse(httpStatus: number, body: unknown): AhrefsResult`, `cacheWriteFor(result: AhrefsResult): { dr: number | null; status: DomainStatus } | null`, `urlUpdateFor(result: AhrefsResult, attempts: number, previous: DomainCacheRow | null, now: Date): Record<string, unknown>`. `attempts` is the row's count **including** the current try (the claim RPC increments it, per Task 4).

- [ ] **Step 1: Write the failing tests**

Create `tests/outcome.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  cacheWriteFor,
  classifyAhrefsResponse,
  urlUpdateFor,
} from "../supabase/functions/process-queue/outcome";
import { NO_DATA_MESSAGE, type DomainCacheRow } from "../supabase/functions/_shared/cache";

const now = new Date("2026-10-07T12:00:00Z");
const staleOk: DomainCacheRow = { domain: "a.com", dr: 40, status: "ok", checked_at: "2026-08-01T00:00:00.000Z" };
const transient = { kind: "transient", error: "Ahrefs HTTP 429" } as const;

describe("classifyAhrefsResponse", () => {
  it("reads nested and flat DR shapes, including 0", () => {
    expect(classifyAhrefsResponse(200, { domain_rating: { domain_rating: 71 } })).toEqual({ kind: "ok", dr: 71 });
    expect(classifyAhrefsResponse(200, { domain_rating: 12.5 })).toEqual({ kind: "ok", dr: 12.5 });
    expect(classifyAhrefsResponse(200, { domain_rating: { domain_rating: 0 } })).toEqual({ kind: "ok", dr: 0 });
  });

  it("treats a 200 without a numeric DR as no_data", () => {
    expect(classifyAhrefsResponse(200, {})).toEqual({ kind: "no_data" });
    expect(classifyAhrefsResponse(200, null)).toEqual({ kind: "no_data" });
  });

  it("treats any non-200 as transient", () => {
    expect(classifyAhrefsResponse(429, null)).toEqual({ kind: "transient", error: "Ahrefs HTTP 429" });
    expect(classifyAhrefsResponse(503, null)).toEqual({ kind: "transient", error: "Ahrefs HTTP 503" });
  });
});

describe("cacheWriteFor", () => {
  it("caches ok and no_data, never transient", () => {
    expect(cacheWriteFor({ kind: "ok", dr: 5 })).toEqual({ dr: 5, status: "ok" });
    expect(cacheWriteFor({ kind: "no_data" })).toEqual({ dr: null, status: "no_data" });
    expect(cacheWriteFor(transient)).toBeNull();
  });
});

describe("urlUpdateFor", () => {
  it("marks a live DR as done/live", () => {
    expect(urlUpdateFor({ kind: "ok", dr: 5 }, 1, null, now)).toEqual({
      status: "done",
      dr: 5,
      source: "live",
      checked_at: now.toISOString(),
      error_message: null,
    });
  });

  it("marks no_data as error/no_data", () => {
    expect(urlUpdateFor({ kind: "no_data" }, 1, null, now)).toEqual({
      status: "error",
      dr: null,
      source: "no_data",
      checked_at: now.toISOString(),
      error_message: NO_DATA_MESSAGE,
    });
  });

  it("requeues transient failures with 30s x attempts backoff", () => {
    expect(urlUpdateFor(transient, 1, null, now)).toEqual({
      status: "pending",
      available_at: "2026-10-07T12:00:30.000Z",
      error_message: "Ahrefs HTTP 429",
    });
    expect(urlUpdateFor(transient, 2, null, now)).toMatchObject({ available_at: "2026-10-07T12:01:00.000Z" });
  });

  it("falls back to a stale DR once attempts are used up", () => {
    expect(urlUpdateFor(transient, 3, staleOk, now)).toEqual({
      status: "done",
      dr: 40,
      source: "stale",
      checked_at: staleOk.checked_at,
      error_message: null,
    });
  });

  it("errors once attempts are used up and there is no stale DR, even past the max", () => {
    const noData: DomainCacheRow = { domain: "a.com", dr: null, status: "no_data", checked_at: staleOk.checked_at };
    for (const previous of [null, noData]) {
      expect(urlUpdateFor(transient, 3, previous, now)).toEqual({
        status: "error",
        dr: null,
        source: null,
        checked_at: null,
        error_message: "Ahrefs HTTP 429",
      });
    }
    expect(urlUpdateFor(transient, 4, null, now)).toMatchObject({ status: "error" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL, because `supabase/functions/process-queue/outcome` cannot be resolved.

- [ ] **Step 3: Implement `supabase/functions/process-queue/outcome.ts`**

```ts
// Pure decisions for the process-queue worker: how to read an Ahrefs
// response, what to write to the url row, and what (if anything) to cache
// in `domains`. Kept free of Deno/Supabase imports so Vitest can test it.

import { NO_DATA_MESSAGE, type DomainCacheRow, type DomainStatus } from "../_shared/cache.ts";

export const MAX_ATTEMPTS = 3;
export const BACKOFF_SECONDS = 30;

export type AhrefsResult =
  | { kind: "ok"; dr: number }
  | { kind: "no_data" }
  | { kind: "transient"; error: string };

export function classifyAhrefsResponse(httpStatus: number, body: unknown): AhrefsResult {
  if (httpStatus !== 200) return { kind: "transient", error: `Ahrefs HTTP ${httpStatus}` };
  // Response shape: { domain_rating: { domain_rating: number, ... } } per Ahrefs docs
  const data = body as any;
  const dr = data?.domain_rating?.domain_rating ?? data?.domain_rating;
  return typeof dr === "number" ? { kind: "ok", dr } : { kind: "no_data" };
}

// Transient failures are never cached, so a rate-limit blip can't poison
// the directory.
export function cacheWriteFor(result: AhrefsResult): { dr: number | null; status: DomainStatus } | null {
  if (result.kind === "ok") return { dr: result.dr, status: "ok" };
  if (result.kind === "no_data") return { dr: null, status: "no_data" };
  return null;
}

// `attempts` includes the current try (claim_pending_urls increments it).
export function urlUpdateFor(
  result: AhrefsResult,
  attempts: number,
  previous: DomainCacheRow | null,
  now: Date,
): Record<string, unknown> {
  if (result.kind === "ok") {
    return { status: "done", dr: result.dr, source: "live", checked_at: now.toISOString(), error_message: null };
  }
  if (result.kind === "no_data") {
    return { status: "error", dr: null, source: "no_data", checked_at: now.toISOString(), error_message: NO_DATA_MESSAGE };
  }
  if (attempts < MAX_ATTEMPTS) {
    return {
      status: "pending",
      available_at: new Date(now.getTime() + BACKOFF_SECONDS * 1000 * attempts).toISOString(),
      error_message: result.error,
    };
  }
  if (previous?.status === "ok" && previous.dr !== null) {
    return { status: "done", dr: previous.dr, source: "stale", checked_at: previous.checked_at, error_message: null };
  }
  return { status: "error", dr: null, source: null, checked_at: null, error_message: result.error };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS (all three test files).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/process-queue/outcome.ts tests/outcome.test.ts
git commit -m "feat(worker): add pure Ahrefs outcome, retry and stale-fallback rules"
```

---

### Task 3: Database schema and migration

**Files:**
- Modify: `supabase/schema.sql` (rewrite to the end state below)
- Create: `supabase/migrations/20261007000000_domain_directory.sql`

**Interfaces:**
- Produces (DB contract used by Tasks 4–6):
  - table `domains(domain text pk, dr numeric null, status text 'ok'|'no_data', checked_at timestamptz)`
  - `urls` columns `source`, `checked_at`, `attempts`, `available_at`, `claimed_at`; no `user_id` on `urls` or `batches`
  - RPC `claim_pending_urls(p_limit integer) returns table(id uuid, domain text, attempts integer)`
  - RPC `register_check_request(p_ip text, p_limit integer) returns boolean`
  - broadcast events `url` (`id, original_url, domain, dr, status, error_message, source, checked_at`) and `batch` (`id, total_urls, processed_urls, status`) on topic `batch:<batch uuid>`, public (`private = false`)

No automated test harness for SQL exists (no Supabase CLI or Docker locally). Verification is by running the files in the Supabase SQL editor, in Step 3.

- [ ] **Step 1: Write the migration `supabase/migrations/20261007000000_domain_directory.sql`**

```sql
-- ============================================================================
-- Domain directory (ADR 0001): domains cache/directory, anonymous batches,
-- retries + stuck-row recovery, broadcast-based live sync, per-IP limits.
-- Upgrades a project created from the previous schema.sql. Fresh installs
-- should run supabase/schema.sql instead.
-- ============================================================================

begin;

-- 1. domains: the public directory and the DR cache -------------------------
create table if not exists public.domains (
  domain     text primary key,
  dr         numeric,
  status     text not null check (status in ('ok', 'no_data')),
  checked_at timestamptz not null default now()
);
create index if not exists idx_domains_dr on public.domains (dr);
create index if not exists idx_domains_checked_at on public.domains (checked_at);
alter table public.domains enable row level security;

insert into public.domains (domain, dr, status, checked_at)
select domain, dr, 'ok', checked_at
from public.domain_summary
where dr is not null
on conflict (domain) do nothing;

-- 2. urls: provenance, retries, stuck-row recovery --------------------------
alter table public.urls
  add column if not exists source       text check (source in ('live', 'cache', 'stale', 'no_data')),
  add column if not exists checked_at   timestamptz,
  add column if not exists attempts     integer not null default 0,
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists claimed_at   timestamptz;

update public.urls
set source = 'live', checked_at = updated_at
where status = 'done' and source is null;

drop index if exists public.idx_urls_status_pending;
create index if not exists idx_urls_claimable
  on public.urls (status, available_at)
  where status in ('pending', 'processing');

-- 3. accounts out: policies, FKs, columns, then the throwaway users ---------
-- Order matters: user_id FKs are ON DELETE CASCADE, so the columns must be
-- gone before the auth users are deleted or every batch would be wiped.
drop policy if exists "users read own batches" on public.batches;
drop policy if exists "users read own urls" on public.urls;
alter table public.urls drop column if exists user_id;
alter table public.batches drop column if exists user_id;  -- also drops idx_batches_user_id

delete from auth.users where email like '%@dr-checker.local';

-- 4. view replaced by the domains table --------------------------------------
drop view if exists public.domain_summary;

-- 5. claim: available_at gating + reclaim of stuck rows ---------------------
drop function if exists public.claim_pending_urls(integer);
create function public.claim_pending_urls(p_limit integer default 5)
returns table (id uuid, domain text, attempts integer)
language plpgsql
as $$
begin
  return query
  update public.urls
  set status = 'processing',
      claimed_at = now(),
      attempts = urls.attempts + 1
  where urls.id in (
    select u.id
    from public.urls u
    where (u.status = 'pending' and u.available_at <= now())
       or (u.status = 'processing' and u.claimed_at < now() - interval '2 minutes')
    order by u.available_at
    limit p_limit
    for update skip locked
  )
  returning urls.id, urls.domain, urls.attempts;
end;
$$;
revoke execute on function public.claim_pending_urls(integer) from public, anon, authenticated;

-- 6. per-IP rate limiting ------------------------------------------------------
create table if not exists public.check_requests (
  id         bigint generated always as identity primary key,
  ip         text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_check_requests_ip_created on public.check_requests (ip, created_at);
alter table public.check_requests enable row level security;

create or replace function public.register_check_request(p_ip text, p_limit integer default 10)
returns boolean
language plpgsql
as $$
declare
  v_recent integer;
begin
  -- serialize concurrent requests from the same IP so the count is exact
  perform pg_advisory_xact_lock(hashtext(p_ip));

  select count(*) into v_recent
  from public.check_requests
  where ip = p_ip and created_at > now() - interval '1 minute';

  if v_recent >= p_limit then
    return false;
  end if;

  insert into public.check_requests (ip) values (p_ip);
  return true;
end;
$$;
revoke execute on function public.register_check_request(text, integer) from public, anon, authenticated;

-- 7. live sync: broadcast instead of postgres_changes -----------------------
create or replace function public.broadcast_url_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id,
      'original_url', new.original_url,
      'domain', new.domain,
      'dr', new.dr,
      'status', new.status,
      'error_message', new.error_message,
      'source', new.source,
      'checked_at', new.checked_at
    ),
    'url',
    'batch:' || new.batch_id::text,
    false
  );
  return null;
end;
$$;

create or replace function public.broadcast_batch_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id,
      'total_urls', new.total_urls,
      'processed_urls', new.processed_urls,
      'status', new.status
    ),
    'batch',
    'batch:' || new.id::text,
    false
  );
  return null;
end;
$$;

drop trigger if exists trg_broadcast_url on public.urls;
create trigger trg_broadcast_url
  after update on public.urls
  for each row execute function public.broadcast_url_change();

drop trigger if exists trg_broadcast_batch on public.batches;
create trigger trg_broadcast_batch
  after update on public.batches
  for each row execute function public.broadcast_batch_change();

do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'urls') then
    alter publication supabase_realtime drop table public.urls;
  end if;
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'batches') then
    alter publication supabase_realtime drop table public.batches;
  end if;
end;
$$;

commit;

-- 8. cleanup job (outside the transaction: pg_cron manages its own) --------
select cron.unschedule(jobid) from cron.job where jobname = 'check-requests-cleanup';
select cron.schedule(
  'check-requests-cleanup',
  '0 * * * *',
  $$delete from public.check_requests where created_at < now() - interval '1 day'$$
);
```

- [ ] **Step 2: Rewrite `supabase/schema.sql` to the end state**

Replace the file with the content below. It is the fresh-install equivalent of the old schema plus the migration. The pg_cron backstop block at the bottom stays verbatim from the current file.

```sql
-- ============================================================================
-- DR Checker schema (end state, see specs/adr/0001-domain-directory.md)
-- Fresh installs: run this in the Supabase SQL editor.
-- Existing projects: run supabase/migrations/20261007000000_domain_directory.sql
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

-- One row per submitted check (typed list or CSV). Anonymous: the
-- unguessable id in the results link is the only key.
create table if not exists public.batches (
  id             uuid primary key default gen_random_uuid(),
  filename       text not null,
  total_urls     integer not null default 0,
  processed_urls integer not null default 0,
  status         text not null default 'pending'
                 check (status in ('pending', 'processing', 'completed', 'failed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.urls (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.batches (id) on delete cascade,
  original_url  text not null,
  domain        text not null,
  dr            numeric,
  status        text not null default 'pending'
                check (status in ('pending', 'processing', 'done', 'error')),
  error_message text,
  -- provenance: where the DR came from and when it was actually fetched
  source        text check (source in ('live', 'cache', 'stale', 'no_data')),
  checked_at    timestamptz,
  -- retries / stuck-row recovery (see claim_pending_urls)
  attempts      integer not null default 0,
  available_at  timestamptz not null default now(),
  claimed_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_urls_batch_id on public.urls (batch_id);
create index if not exists idx_urls_claimable
  on public.urls (status, available_at)
  where status in ('pending', 'processing');

-- The public directory and the DR cache. 'ok' rows are fresh for 30 days,
-- 'no_data' rows for 7 (TTLs live in supabase/functions/_shared/cache.ts).
-- Transient Ahrefs failures are never written here.
create table if not exists public.domains (
  domain     text primary key,
  dr         numeric,
  status     text not null check (status in ('ok', 'no_data')),
  checked_at timestamptz not null default now()
);
create index if not exists idx_domains_dr on public.domains (dr);
create index if not exists idx_domains_checked_at on public.domains (checked_at);

-- Per-IP request log for /api/check rate limiting.
create table if not exists public.check_requests (
  id         bigint generated always as identity primary key,
  ip         text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_check_requests_ip_created on public.check_requests (ip, created_at);

-- keep `updated_at` fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_batches_updated_at on public.batches;
create trigger trg_batches_updated_at
  before update on public.batches
  for each row execute function public.set_updated_at();

drop trigger if exists trg_urls_updated_at on public.urls;
create trigger trg_urls_updated_at
  before update on public.urls
  for each row execute function public.set_updated_at();

-- Roll batch.processed_urls / status up whenever a url row finishes.
-- Rows inserted already resolved (cache hits) are pre-counted by
-- /api/check, since this only fires on UPDATE.
create or replace function public.bump_batch_progress()
returns trigger language plpgsql as $$
declare
  v_total     integer;
  v_processed integer;
begin
  if (tg_op = 'UPDATE' and old.status <> new.status and new.status in ('done', 'error')) then
    select total_urls into v_total from public.batches where id = new.batch_id;

    select count(*) into v_processed
    from public.urls
    where batch_id = new.batch_id and status in ('done', 'error');

    update public.batches
    set processed_urls = v_processed,
        status = case when v_processed >= v_total then 'completed' else 'processing' end
    where id = new.batch_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bump_batch_progress on public.urls;
create trigger trg_bump_batch_progress
  after update on public.urls
  for each row execute function public.bump_batch_progress();

-- ----------------------------------------------------------------------------
-- Atomic claim: up to p_limit rows that are pending and due, plus any
-- 'processing' rows whose worker died (claimed > 2 minutes ago). Each claim
-- counts as an attempt. FOR UPDATE SKIP LOCKED keeps concurrent
-- invocations (webhook + cron) from double-processing a row.
-- ----------------------------------------------------------------------------

drop function if exists public.claim_pending_urls(integer);
create function public.claim_pending_urls(p_limit integer default 5)
returns table (id uuid, domain text, attempts integer)
language plpgsql
as $$
begin
  return query
  update public.urls
  set status = 'processing',
      claimed_at = now(),
      attempts = urls.attempts + 1
  where urls.id in (
    select u.id
    from public.urls u
    where (u.status = 'pending' and u.available_at <= now())
       or (u.status = 'processing' and u.claimed_at < now() - interval '2 minutes')
    order by u.available_at
    limit p_limit
    for update skip locked
  )
  returning urls.id, urls.domain, urls.attempts;
end;
$$;

-- ----------------------------------------------------------------------------
-- Rate limiting: records the request and returns true, or returns false if
-- the IP already made p_limit requests in the last minute.
-- ----------------------------------------------------------------------------

create or replace function public.register_check_request(p_ip text, p_limit integer default 10)
returns boolean
language plpgsql
as $$
declare
  v_recent integer;
begin
  -- serialize concurrent requests from the same IP so the count is exact
  perform pg_advisory_xact_lock(hashtext(p_ip));

  select count(*) into v_recent
  from public.check_requests
  where ip = p_ip and created_at > now() - interval '1 minute';

  if v_recent >= p_limit then
    return false;
  end if;

  insert into public.check_requests (ip) values (p_ip);
  return true;
end;
$$;

-- RPCs are server-only (service role).
revoke execute on function public.claim_pending_urls(integer) from public, anon, authenticated;
revoke execute on function public.register_check_request(text, integer) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Row Level Security: enabled with NO policies, so nothing is readable with
-- the anon key. All access goes through the server's service-role client.
-- ----------------------------------------------------------------------------

alter table public.batches enable row level security;
alter table public.urls enable row level security;
alter table public.domains enable row level security;
alter table public.check_requests enable row level security;

-- ----------------------------------------------------------------------------
-- Live sync: broadcast client-facing fields to the public channel
-- 'batch:<batch id>'. Knowing the batch id is the only way to listen.
-- ----------------------------------------------------------------------------

create or replace function public.broadcast_url_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id,
      'original_url', new.original_url,
      'domain', new.domain,
      'dr', new.dr,
      'status', new.status,
      'error_message', new.error_message,
      'source', new.source,
      'checked_at', new.checked_at
    ),
    'url',
    'batch:' || new.batch_id::text,
    false
  );
  return null;
end;
$$;

create or replace function public.broadcast_batch_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id,
      'total_urls', new.total_urls,
      'processed_urls', new.processed_urls,
      'status', new.status
    ),
    'batch',
    'batch:' || new.id::text,
    false
  );
  return null;
end;
$$;

drop trigger if exists trg_broadcast_url on public.urls;
create trigger trg_broadcast_url
  after update on public.urls
  for each row execute function public.broadcast_url_change();

drop trigger if exists trg_broadcast_batch on public.batches;
create trigger trg_broadcast_batch
  after update on public.batches
  for each row execute function public.broadcast_batch_change();

-- ----------------------------------------------------------------------------
-- pg_cron: hourly cleanup of the rate-limit log
-- ----------------------------------------------------------------------------

select cron.unschedule(jobid) from cron.job where jobname = 'check-requests-cleanup';
select cron.schedule(
  'check-requests-cleanup',
  '0 * * * *',
  $$delete from public.check_requests where created_at < now() - interval '1 day'$$
);
```

Then append the existing **"pg_cron backstop"** section (its comment block, `cron.unschedule` and `cron.schedule('process-queue-backstop', ...)`) unchanged from the current `schema.sql`.

- [ ] **Step 3: Verify in Supabase (human step; do it at rollout, see "Rollout")**

The migration breaks the currently deployed app (old `/api/upload` inserts `user_id`), so it must run at deploy time, not now. When it runs, check it in the SQL editor:

```sql
select count(*) from public.domains;                          -- ≈ old domain_summary count
select column_name from information_schema.columns
 where table_schema='public' and table_name in ('urls','batches') and column_name='user_id';  -- 0 rows
select count(*) from auth.users where email like '%@dr-checker.local';  -- 0
select * from public.claim_pending_urls(0);                   -- runs, returns 0 rows
select public.register_check_request('test-ip', 2), public.register_check_request('test-ip', 2),
       public.register_check_request('test-ip', 2);            -- t, t, f
delete from public.check_requests where ip = 'test-ip';
```

For now, review the SQL by reading it against the ADR's "Migration of existing data" order.

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql supabase/migrations/20261007000000_domain_directory.sql
git commit -m "feat(db): domains cache, anonymous batches, retries and broadcast sync"
```

---

### Task 4: `POST /api/check`, rate limiting, and removal of accounts

**Files:**
- Create: `server/utils/createCheck.ts`
- Create: `server/utils/rateLimit.ts`
- Create: `server/api/check.post.ts`
- Delete: `server/api/upload.post.ts`
- Modify: `server/utils/domain.ts` (delete `generateCredentials` and its `ADJECTIVES`/`NOUNS` constants)
- Modify: `server/utils/supabaseAdmin.ts:1-3` (comment: no longer creates auth users)

**Interfaces:**
- Consumes: `buildCheckRows`, `parseCsvUrls`, `parseDomainList`, `planUrlRows`, `resultsDisplay`, `CheckInputError`, `TYPED_MAX`, `CSV_MAX`, `CheckRow`, `CheckSource` (Task 1); `DomainCacheRow` (Task 1); RPC `register_check_request` and the new tables (Task 3).
- Produces: `POST /api/check`, which accepts JSON `{ domains: string }` or multipart `file` and returns `CheckResponse = { batchId: string; total: number; resolved: number; queued: number; skipped: number; display: "inline" | "page" }`. Errors: 400 (input), 429 (rate limit), 500.

- [ ] **Step 1: Implement `server/utils/rateLimit.ts`**

```ts
// Per-IP limit for POST /api/check, stored in Postgres because Nitro runs
// as short-lived Netlify functions (in-memory counters would reset).

import type { H3Event } from "h3";
import { supabaseAdmin } from "./supabaseAdmin";

const REQUESTS_PER_MINUTE = 10;

function clientIp(event: H3Event): string {
  return (
    getRequestHeader(event, "x-nf-client-connection-ip") ??
    getRequestIP(event, { xForwardedFor: true }) ??
    "unknown"
  );
}

export async function assertRateLimit(event: H3Event) {
  const { data, error } = await supabaseAdmin().rpc("register_check_request", {
    p_ip: clientIp(event),
    p_limit: REQUESTS_PER_MINUTE,
  });

  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Rate limit check failed: ${error.message}` });
  }
  if (data !== true) {
    throw createError({ statusCode: 429, statusMessage: "Too many checks — try again in a minute" });
  }
}
```

- [ ] **Step 2: Implement `server/utils/createCheck.ts`**

```ts
// The DB writes behind POST /api/check: read the `domains` cache for the
// submitted domains, insert the batch (pre-counting rows the cache already
// answers, since bump_batch_progress only fires on UPDATE), then insert the
// url rows. Pending rows trigger the process-queue webhook on insert.

import { supabaseAdmin } from "./supabaseAdmin";
import { planUrlRows, resultsDisplay, type CheckRow, type CheckSource } from "./checkInput";
import type { DomainCacheRow } from "../../supabase/functions/_shared/cache";

const LOOKUP_CHUNK = 200; // keeps the `in (...)` filter well under URL length limits
const INSERT_CHUNK = 500;

export interface CheckResponse {
  batchId: string;
  total: number;
  resolved: number;
  queued: number;
  skipped: number;
  display: "inline" | "page";
}

export async function createCheck(opts: {
  rows: CheckRow[];
  skipped: number;
  label: string;
  source: CheckSource;
}): Promise<CheckResponse> {
  const admin = supabaseAdmin();

  const uniqueDomains = [...new Set(opts.rows.map((r) => r.domain))];
  const cache: DomainCacheRow[] = [];
  for (let i = 0; i < uniqueDomains.length; i += LOOKUP_CHUNK) {
    const { data, error } = await admin
      .from("domains")
      .select("domain, dr, status, checked_at")
      .in("domain", uniqueDomains.slice(i, i + LOOKUP_CHUNK));
    if (error) {
      throw createError({ statusCode: 500, statusMessage: `Failed to read cache: ${error.message}` });
    }
    cache.push(...((data ?? []) as DomainCacheRow[]));
  }

  const { planned, resolved } = planUrlRows(opts.rows, cache, new Date());
  const total = planned.length;

  const { data: batch, error: batchError } = await admin
    .from("batches")
    .insert({
      filename: opts.label,
      total_urls: total,
      processed_urls: resolved,
      status: resolved === total ? "completed" : "processing",
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    throw createError({ statusCode: 500, statusMessage: `Failed to create batch: ${batchError?.message}` });
  }

  for (let i = 0; i < planned.length; i += INSERT_CHUNK) {
    const chunk = planned.slice(i, i + INSERT_CHUNK).map((p) => ({ batch_id: batch.id, ...p }));
    const { error: insertError } = await admin.from("urls").insert(chunk);
    if (insertError) {
      throw createError({ statusCode: 500, statusMessage: `Failed to insert URLs: ${insertError.message}` });
    }
  }

  return {
    batchId: batch.id as string,
    total,
    resolved,
    queued: total - resolved,
    skipped: opts.skipped,
    display: resultsDisplay(opts.source, total),
  };
}
```

- [ ] **Step 3: Implement `server/api/check.post.ts`**

```ts
// Single entry point for DR checks: JSON `{ domains: "a.com, b.com\n..." }`
// for typed lookups (max 100) or multipart `file` for CSV uploads (max
// 1,000). Order matters: validate first (so typos don't burn rate-limit
// slots), then rate limit, then write. Processing is picked up by the
// process-queue edge function (webhook + cron), not here.

import type { H3Event } from "h3";
import {
  buildCheckRows,
  CheckInputError,
  CSV_MAX,
  parseCsvUrls,
  parseDomainList,
  TYPED_MAX,
  type CheckSource,
} from "../utils/checkInput";
import { createCheck } from "../utils/createCheck";
import { assertRateLimit } from "../utils/rateLimit";

async function readInputs(
  event: H3Event,
): Promise<{ raw: string[]; label: string; source: CheckSource; max: number }> {
  const contentType = getRequestHeader(event, "content-type") ?? "";

  if (contentType.startsWith("multipart/form-data")) {
    const form = await readMultipartFormData(event);
    const filePart = form?.find((p) => p.name === "file");
    if (!filePart) {
      throw createError({ statusCode: 400, statusMessage: "Missing 'file' field" });
    }
    return {
      raw: parseCsvUrls(filePart.data.toString("utf-8")),
      label: filePart.filename ?? "upload.csv",
      source: "csv",
      max: CSV_MAX,
    };
  }

  const body = await readBody<{ domains?: unknown }>(event);
  if (typeof body?.domains !== "string") {
    throw createError({
      statusCode: 400,
      statusMessage: "Expected JSON { domains: string } or a multipart 'file' field",
    });
  }
  return { raw: parseDomainList(body.domains), label: "Quick check", source: "typed", max: TYPED_MAX };
}

export default defineEventHandler(async (event) => {
  const { raw, label, source, max } = await readInputs(event);

  let built: ReturnType<typeof buildCheckRows>;
  try {
    built = buildCheckRows(raw, max);
  } catch (e) {
    if (e instanceof CheckInputError) {
      throw createError({ statusCode: 400, statusMessage: e.message });
    }
    throw e;
  }

  await assertRateLimit(event);

  return createCheck({ ...built, label, source });
});
```

- [ ] **Step 4: Remove the account code**

```bash
git rm server/api/upload.post.ts
```

In `server/utils/domain.ts`, delete `ADJECTIVES`, `NOUNS` and `generateCredentials` (everything after `normalizeDomain`). In `server/utils/supabaseAdmin.ts`, change the header comment to:

```ts
// Service-role client for server routes only. Bypasses RLS — every read and
// write of batches/urls/domains goes through it, since those tables have no
// anon policies. NEVER import this in client code.
```

Confirm nothing else references the removed code:

Run: `grep -rn "generateCredentials\|api/upload\|signInWithPassword" --include=*.ts --include=*.vue . | grep -v node_modules`
Expected: only `pages/index.vue` matches (fixed in Task 7).

- [ ] **Step 5: Run unit tests and build**

Run: `npm test && npm run build`
Expected: tests PASS; the build succeeds. `pages/index.vue` still compiles because it only calls `/api/upload` at runtime.

- [ ] **Step 6: Commit**

```bash
git add server/
git commit -m "feat(api): add /api/check with cache planning and per-IP rate limit, drop accounts"
```

---

### Task 5: Read endpoints and the edge function

**Files:**
- Modify: `server/api/domains.get.ts` (read `domains`)
- Modify: `server/api/status/[batchId].get.ts:30` (select provenance)
- Modify: `server/api/download/[batchId].get.ts` (CSV provenance columns)
- Modify: `supabase/functions/process-queue/index.ts` (rewrite)

**Interfaces:**
- Consumes: `outcome.ts` (Task 2), `_shared/cache.ts` (Task 1), the DB contract (Task 3).
- Produces: `/api/status/[batchId]` url rows now include `source: "live" | "cache" | "stale" | "no_data" | null` and `checked_at: string | null`. The download CSV header becomes `url,domain,domain_rating,status,source,checked_at`.

- [ ] **Step 1: Point the directory at `domains`**

In `server/api/domains.get.ts`, replace the header comment with:

```ts
// Public (no auth required): powers the domain directory on the home page.
// Reads the `domains` table (one row per domain, latest DR + check date)
// via the service-role client, since the table has no anon policies.
// Only 'ok' rows are listed; 'no_data' rows are cache-only.
```

and replace the query construction line:

```ts
  let q = admin
    .from("domains")
    .select("domain, dr, checked_at", { count: "exact" })
    .eq("status", "ok");
```

Everything else (filters, sort, pagination) stays.

- [ ] **Step 2: Expose provenance in status and download**

In `server/api/status/[batchId].get.ts`, change the urls select to:

```ts
    .select("id, original_url, domain, dr, status, error_message, source, checked_at")
```

In `server/api/download/[batchId].get.ts`, replace `toCsv` and the urls select:

```ts
type CsvRow = {
  original_url: string;
  domain: string;
  dr: number | null;
  status: string;
  source: string | null;
  checked_at: string | null;
};

function toCsv(rows: CsvRow[]) {
  const header = "url,domain,domain_rating,status,source,checked_at";
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [escape(r.original_url), escape(r.domain), r.dr ?? "", r.status, r.source ?? "", r.checked_at ?? ""].join(","),
  );
  return [header, ...lines].join("\n");
}
```

```ts
    .select("original_url, domain, dr, status, source, checked_at")
```

- [ ] **Step 3: Rewrite `supabase/functions/process-queue/index.ts`**

```ts
// Invoked by:
//   1. A Database Webhook on `urls` INSERT (fast start)
//   2. A pg_cron backstop every ~10s (see schema.sql)
//
// Each invocation claims a few due url rows (FOR UPDATE SKIP LOCKED, so
// concurrent invocations never double-process; stuck 'processing' rows are
// reclaimed after 2 minutes), groups them by domain, answers from the
// `domains` cache when another batch fetched the domain recently, and
// otherwise calls Ahrefs once per domain. Results go to the url rows and,
// unless transient, to `domains`. Decisions live in ./outcome.ts; table
// triggers roll batch progress up and broadcast changes to the browser.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cachedUrlFields, isFresh, type DomainCacheRow } from "../_shared/cache.ts";
import { cacheWriteFor, classifyAhrefsResponse, urlUpdateFor, type AhrefsResult } from "./outcome.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AHREFS_DR_RATING_KEY = Deno.env.get("AHREFS_DR_RATING")!;

const CLAIM_SIZE = 5; // urls claimed per invocation, keep small = gentle on Ahrefs' rate limit
const AHREFS_DELAY_MS = 300; // spacing between outbound Ahrefs calls

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

type ClaimedRow = { id: string; domain: string; attempts: number };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDomainRating(domain: string): Promise<AhrefsResult> {
  const url = `https://api.ahrefs.com/v3/public/domain-rating-free?target=${encodeURIComponent(
    domain,
  )}&output=json`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${AHREFS_DR_RATING_KEY}`,
      },
    });
    const body = res.ok ? await res.json().catch(() => null) : null;
    return classifyAhrefsResponse(res.status, body);
  } catch (err) {
    return { kind: "transient", error: String(err) };
  }
}

async function updateUrl(id: string, fields: Record<string, unknown>) {
  const { error } = await supabase.from("urls").update(fields).eq("id", id);
  if (error) console.error("url update failed", id, error.message);
}

Deno.serve(async () => {
  // 1. Claim due rows atomically
  const { data: claimed, error: claimError } = await supabase.rpc("claim_pending_urls", {
    p_limit: CLAIM_SIZE,
  });

  if (claimError) {
    console.error("claim error", claimError);
    return new Response(JSON.stringify({ error: claimError.message }), { status: 500 });
  }

  const rows = (claimed ?? []) as ClaimedRow[];
  if (rows.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
  }

  // 2. Group by domain and load what the cache knows about them
  const byDomain = new Map<string, ClaimedRow[]>();
  for (const row of rows) byDomain.set(row.domain, [...(byDomain.get(row.domain) ?? []), row]);

  const { data: cacheRows, error: cacheError } = await supabase
    .from("domains")
    .select("domain, dr, status, checked_at")
    .in("domain", [...byDomain.keys()]);
  if (cacheError) console.error("cache read failed, calling Ahrefs for all", cacheError.message);
  const cache = new Map(((cacheRows ?? []) as DomainCacheRow[]).map((c) => [c.domain, c]));

  // 3. Resolve each domain: fresh cache hit, or one Ahrefs call
  const writes: Promise<unknown>[] = [];
  let calledAhrefs = false;

  for (const [domain, domainRows] of byDomain) {
    const previous = cache.get(domain) ?? null;

    if (previous && isFresh(previous, new Date())) {
      for (const row of domainRows) writes.push(updateUrl(row.id, cachedUrlFields(previous)));
      continue;
    }

    if (calledAhrefs) await sleep(AHREFS_DELAY_MS);
    calledAhrefs = true;

    const result = await fetchDomainRating(domain);
    const checkedAt = new Date();

    const cacheWrite = cacheWriteFor(result);
    if (cacheWrite) {
      writes.push(
        supabase
          .from("domains")
          .upsert({ domain, ...cacheWrite, checked_at: checkedAt.toISOString() })
          .then(({ error }) => {
            if (error) console.error("domains upsert failed", domain, error.message);
          }),
      );
    }

    for (const row of domainRows) {
      writes.push(updateUrl(row.id, urlUpdateFor(result, row.attempts, previous, checkedAt)));
    }
  }

  await Promise.all(writes);

  return new Response(JSON.stringify({ processed: rows.length }), { status: 200 });
});
```

- [ ] **Step 4: Type-check the edge function and run tests and build**

Run: `deno check supabase/functions/process-queue/index.ts && npm test && npm run build`
Expected: `deno check` reports no errors; tests PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add server/api supabase/functions/process-queue/index.ts
git commit -m "feat(worker): cache-aware processing with retries; read endpoints use domains"
```

---

### Task 6: Live sync and the shared results component

**Files:**
- Modify: `composables/useBatchRealtime.ts` (rewrite)
- Create: `components/CheckResults.vue`
- Modify: `pages/results/[batchId].vue` (rewrite as a wrapper)

**Interfaces:**
- Consumes: broadcast events `url`/`batch` on `batch:<id>` (Task 3); `/api/status/[batchId]` with `source`/`checked_at` (Task 5); `/api/download/[batchId]`.
- Produces: `useBatchRealtime(batchId: string): { batch, urls, loading, error, progressPct }` (same shape as before; `UrlRow` gains `source` and `checked_at`). `<CheckResults :batch-id="string" :show-title="boolean = true" @completed="() => void" />`; `completed` is emitted once when the batch status becomes `completed`.

- [ ] **Step 1: Rewrite `composables/useBatchRealtime.ts`**

```ts
// Live progress for one batch via Supabase Realtime *broadcast*: DB
// triggers (broadcast_url_change / broadcast_batch_change in schema.sql)
// push client-facing fields to the public channel `batch:<id>`. The tables
// themselves are not readable with the anon key. We subscribe *before*
// loading the /api/status snapshot so fast batches (cache hits, 1-domain
// checks) can't finish in the gap; rows already received live win over the
// snapshot.

import { useSupabase } from "./useSupabase";

export interface UrlRow {
  id: string;
  original_url: string;
  domain: string;
  dr: number | null;
  status: "pending" | "processing" | "done" | "error";
  error_message?: string | null;
  source: "live" | "cache" | "stale" | "no_data" | null;
  checked_at: string | null;
}

export interface BatchRow {
  id: string;
  filename: string;
  total_urls: number;
  processed_urls: number;
  status: "pending" | "processing" | "completed" | "failed";
}

type BatchProgress = Omit<BatchRow, "filename">;

const SUBSCRIBE_TIMEOUT_MS = 3000;

export function useBatchRealtime(batchId: string) {
  const supabase = useSupabase();

  const batch = ref<BatchRow | null>(null);
  const urls = ref<UrlRow[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  let channel: ReturnType<typeof supabase.channel> | null = null;
  let liveBatch: Partial<BatchProgress> = {};

  function upsertUrl(row: UrlRow) {
    const idx = urls.value.findIndex((u) => u.id === row.id);
    if (idx === -1) urls.value.push(row);
    else urls.value[idx] = row;
  }

  function subscribe(): Promise<void> {
    return new Promise((resolve) => {
      // Don't block first paint forever if websockets are blocked.
      const timer = setTimeout(resolve, SUBSCRIBE_TIMEOUT_MS);
      channel = supabase
        .channel(`batch:${batchId}`, { config: { private: false } })
        .on("broadcast", { event: "url" }, ({ payload }) => upsertUrl(payload as UrlRow))
        .on("broadcast", { event: "batch" }, ({ payload }) => {
          liveBatch = { ...liveBatch, ...(payload as BatchProgress) };
          if (batch.value) batch.value = { ...batch.value, ...liveBatch };
        })
        .subscribe((status) => {
          if (status !== "SUBSCRIBED" && status !== "CHANNEL_ERROR" && status !== "TIMED_OUT") return;
          clearTimeout(timer);
          resolve();
        });
    });
  }

  async function loadInitial() {
    try {
      const res = await $fetch<{ batch: BatchRow; urls: UrlRow[] }>(`/api/status/${batchId}`);
      const live = new Map(urls.value.map((u) => [u.id, u]));
      urls.value = res.urls.map((u) => live.get(u.id) ?? u);
      batch.value = { ...res.batch, ...liveBatch };
    } catch (e: any) {
      error.value = e?.data?.statusMessage ?? "Failed to load batch";
    } finally {
      loading.value = false;
    }
  }

  onMounted(async () => {
    await subscribe();
    await loadInitial();
  });

  onUnmounted(() => {
    if (channel) supabase.removeChannel(channel);
  });

  const progressPct = computed(() => {
    if (!batch.value || batch.value.total_urls === 0) return 0;
    return Math.round((batch.value.processed_urls / batch.value.total_urls) * 100);
  });

  return { batch, urls, loading, error, progressPct };
}
```

- [ ] **Step 2: Create `components/CheckResults.vue`**

Move the progress card, download button, table, `sortedUrls`, `statusLabel`, `statusBadgeClass` and `download` from `pages/results/[batchId].vue` into this component, and add provenance badges:

```vue
<template>
  <div>
    <div v-if="loading" class="mt-6 text-[#86868b]">Loading results…</div>
    <div v-else-if="error" class="mt-6 text-red-600">{{ error }}</div>

    <template v-else-if="batch">
      <h1 v-if="showTitle" class="mt-4 text-3xl font-semibold tracking-tight text-[#1d1d1f]">{{ batch.filename }}</h1>

      <div class="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <div class="flex justify-between text-sm text-[#6e6e73] mb-2">
          <span>{{ statusLabel }}</span>
          <span>{{ batch.processed_urls }} / {{ batch.total_urls }}</span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-black/5">
          <div class="h-full rounded-full bg-accent transition-all duration-300" :style="{ width: progressPct + '%' }" />
        </div>
      </div>

      <button v-if="batch.processed_urls"
        class="mt-6 rounded-full bg-[#1d1d1f] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-black"
        @click="download">
        Download CSV
      </button>

      <div class="mt-8 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[560px] text-sm border-collapse">
            <thead>
              <tr class="text-left text-[#6e6e73] border-b border-black/5">
                <th class="py-3 px-4 font-medium">URL</th>
                <th class="py-3 px-4 font-medium">Domain</th>
                <th class="py-3 px-4 font-medium">DR</th>
                <th class="py-3 px-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in sortedUrls" :key="row.id"
                class="border-b border-black/5 last:border-0 transition-colors hover:bg-black/[0.02]">
                <td class="py-2.5 px-4 truncate max-w-[220px]" :title="row.original_url">{{ row.original_url }}</td>
                <td class="py-2.5 px-4 text-[#6e6e73]">{{ row.domain }}</td>
                <td class="py-2.5 px-4">
                  <span class="font-medium">{{ row.dr ?? "—" }}</span>
                  <span v-if="sourceBadge(row)" :class="sourceBadge(row)!.class" :title="sourceBadge(row)!.title"
                    class="ml-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium">
                    {{ sourceBadge(row)!.label }}
                  </span>
                  <div v-if="row.checked_at && row.dr !== null" class="text-xs text-[#86868b]">
                    checked {{ checkedAgo(row.checked_at) }}
                  </div>
                </td>
                <td class="py-2.5 px-4">
                  <span :class="statusBadgeClass(row.status)">{{ row.status }} <small v-if="row.status === 'error'">
                      ({{ row.error_message }})
                    </small>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { UrlRow } from "~/composables/useBatchRealtime";

const props = withDefaults(defineProps<{ batchId: string; showTitle?: boolean }>(), { showTitle: true });
const emit = defineEmits<{ completed: [] }>();

const { batch, urls, loading, error, progressPct } = useBatchRealtime(props.batchId);

watch(
  () => batch.value?.status,
  (status, prev) => {
    if (status === "completed" && prev !== "completed") emit("completed");
  },
);

const sortedUrls = computed(() =>
  [...urls.value].sort((a, b) => a.original_url.localeCompare(b.original_url)),
);

const statusLabel = computed(() => {
  switch (batch.value?.status) {
    case "pending":
      return "Queued…";
    case "processing":
      return "Processing…";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "";
  }
});

function statusBadgeClass(status: string) {
  const base = "inline-block rounded-full px-2.5 py-0.5 text-xs font-medium";
  switch (status) {
    case "done":
      return `${base} bg-green-100 text-green-700`;
    case "error":
      return `${base} bg-red-100 text-red-700`;
    case "processing":
      return `${base} bg-accent-light text-accent`;
    default:
      return `${base} bg-black/5 text-[#6e6e73]`;
  }
}

function sourceBadge(row: UrlRow) {
  switch (row.source) {
    case "live":
      return { label: "live", class: "bg-accent-light text-accent", title: "Fetched from Ahrefs just now" };
    case "cache":
      return { label: "cached", class: "bg-black/5 text-[#6e6e73]", title: "From the directory (checked in the last 30 days)" };
    case "stale":
      return { label: "stale", class: "bg-amber-100 text-amber-800", title: "Ahrefs was unavailable; showing the last known DR" };
    default:
      return null;
  }
}

function checkedAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function download() {
  window.location.href = `/api/download/${props.batchId}`;
}
</script>
```

- [ ] **Step 3: Rewrite `pages/results/[batchId].vue`**

```vue
<template>
  <div class="mx-auto max-w-3xl px-4 py-16">
    <NuxtLink to="/" class="text-sm text-[#6e6e73] transition-colors hover:text-accent">← New check</NuxtLink>
    <CheckResults :batch-id="batchId" />
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const batchId = route.params.batchId as string;
</script>
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add composables/useBatchRealtime.ts components/CheckResults.vue "pages/results/[batchId].vue"
git commit -m "feat(results): broadcast-based live sync and shared CheckResults component"
```

---

### Task 7: Lookup-first home page

**Files:**
- Modify: `pages/index.vue` (hero/form block and the script's upload section; the directory section's heading only)

**Interfaces:**
- Consumes: `POST /api/check` → `CheckResponse` (Task 4); `<CheckResults>` with `completed` (Task 6).
- Produces: route `/?check=<id>` renders inline results.

- [ ] **Step 1: Replace the hero and upload form**

Replace everything from `<!-- Hero -->` down to (and including) the credentials `<div v-if="credentials" ...>…</div>` block with:

```vue
    <!-- Hero -->
    <section class="bg-hero-radial px-4 pb-14 pt-16 text-center sm:pb-20 sm:pt-24">
      <h1 class="text-4xl font-semibold tracking-tight text-[#1d1d1f] sm:text-5xl">
        Domain Rating Checker
      </h1>
      <p class="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-[#6e6e73]">
        Check the Ahrefs DR of any domain — type a few, or upload a CSV of up to 1,000.
        <NuxtLink class="text-accent hover:underline" to="/docs">
          Find out how to use it.
        </NuxtLink>
      </p>
    </section>

    <div class="mx-auto max-w-2xl px-4 pb-24">
      <form class="space-y-4" @submit.prevent="onSubmit">
        <textarea v-if="mode === 'typed'" v-model="domainsText" rows="4"
          placeholder="example.com, another-site.org&#10;one per line or comma-separated (max 100)"
          aria-label="Domains to check"
          class="w-full rounded-2xl border border-black/10 bg-white p-4 text-[15px] text-[#1d1d1f] shadow-sm transition-colors focus:border-accent/50 focus:outline-none" />

        <label v-else
          class="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-black/15 bg-white p-12 text-center shadow-sm transition-colors cursor-pointer hover:border-accent/50 hover:bg-accent-light/40">
          <span class="text-[15px] font-medium text-[#1d1d1f]">
            {{ file ? file.name : "Click to choose a CSV file" }}
          </span>
          <span class="text-xs text-[#86868b]">Max 1,000 URLs</span>
          <input type="file" accept=".csv,text/csv" class="hidden" @change="onFileChange" />
        </label>

        <button type="submit" :disabled="!canSubmit || submitting"
          class="w-full rounded-full bg-accent px-4 py-3 text-[15px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-black/20">
          {{ submitting ? "Checking…" : "Check DR" }}
        </button>

        <div class="flex items-center justify-between text-sm">
          <button type="button" class="text-accent hover:underline" @click="toggleMode">
            {{ mode === "typed" ? "or upload a CSV" : "or type domains" }}
          </button>
          <span class="text-xs text-[#86868b]">Checked domains are added to the public directory below.</span>
        </div>

        <p v-if="errorMsg" class="text-sm text-red-600">{{ errorMsg }}</p>
        <p v-if="infoMsg" class="text-sm text-[#6e6e73]">{{ infoMsg }}</p>
      </form>

      <!-- Inline results for small typed checks -->
      <CheckResults v-if="inlineCheckId" :key="inlineCheckId" :batch-id="inlineCheckId" :show-title="false"
        @completed="loadDomains(domainsPage)" />
```

In the directory section, change the heading text `Previously checked domains` to `Domain directory` and the subtitle to `Every domain checked so far, with its latest DR.`. Leave the rest of the directory markup unchanged.

- [ ] **Step 2: Replace the upload script**

Replace everything in `<script setup>` from `const file = ref<File | null>(null);` through the end of `onSubmit` (just before `// ---- Previously processed domains table`) with:

```ts
import type { CheckResponse } from "~/server/utils/createCheck";

const mode = ref<"typed" | "csv">("typed");
const domainsText = ref("");
const file = ref<File | null>(null);
const submitting = ref(false);
const errorMsg = ref("");
const infoMsg = ref("");

const route = useRoute();
const router = useRouter();
const inlineCheckId = computed(() =>
  typeof route.query.check === "string" ? route.query.check : null,
);

const canSubmit = computed(() =>
  mode.value === "typed" ? domainsText.value.trim().length > 0 : !!file.value,
);

function toggleMode() {
  mode.value = mode.value === "typed" ? "csv" : "typed";
  errorMsg.value = "";
}

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  file.value = target.files?.[0] ?? null;
}

async function onSubmit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  errorMsg.value = "";
  infoMsg.value = "";

  try {
    let body: FormData | { domains: string };
    if (mode.value === "typed") {
      body = { domains: domainsText.value };
    } else {
      body = new FormData();
      body.append("file", file.value!);
    }

    const res = await $fetch<CheckResponse>("/api/check", { method: "POST", body });

    if (res.skipped) infoMsg.value = `Skipped ${res.skipped} entr${res.skipped === 1 ? "y" : "ies"} that weren't valid domains.`;

    if (res.display === "inline") {
      await router.replace({ query: { check: res.batchId } });
    } else {
      await navigateTo(`/results/${res.batchId}`);
    }
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage ?? "Check failed. Please try again.";
  } finally {
    submitting.value = false;
  }
}
```

(`useSupabase`, `credentials`, `batchId` and the `signInWithPassword` call are gone.)

- [ ] **Step 3: Build and confirm no account code remains**

Run: `npm run build && grep -rn "generateCredentials\|api/upload\|signInWithPassword\|credentials" server composables components pages/index.vue "pages/results"`
Expected: build succeeds; grep prints nothing (`pages/docs.vue` is updated in Task 8).

- [ ] **Step 4: Smoke test the UI against the dev server**

This needs the Task 3 migration applied and the Task 5 function deployed (see "Rollout"). If they are not yet applied, defer this step to Rollout step 4.

Run: `npm run dev`, open `http://localhost:3000`:
- type `ahrefs.com, example.com` → the URL becomes `/?check=<id>` and rows go pending → done/`live`; reload keeps the inline results;
- submit the same again → completes instantly with `cached` badges;
- paste 11 domains → redirects to `/results/<id>`;
- type `localhost` → error "No valid domains found".

- [ ] **Step 5: Commit**

```bash
git add pages/index.vue
git commit -m "feat(home): lookup-first form with inline results and domain directory"
```

---

### Task 8: Documentation

**Files:**
- Modify: `pages/docs.vue`
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: final behavior from Tasks 1–7.
- Produces: none.

- [ ] **Step 1: Rewrite `pages/docs.vue` sections**

Keep the page layout and table of contents styling. Update the TOC labels and these sections, using this exact content:
- **1. Overview:** The tool checks Ahrefs DR for domains you type (up to 100) or upload as a CSV (up to 1,000). There are no accounts; every check gets a private results link. Every domain with a DR is added to the public directory on the home page.
- **2. Checking domains:** Type domains one per line or comma-separated. URLs are fine (`https://www.example.com/page` → `example.com`); only a leading `www.` is removed, so subdomains are checked separately. Entries without a dot (e.g. `localhost`) are skipped. Up to 10 domains show results right on the home page; more redirect to a results page.
- **3. Preparing your CSV file:** the existing two formats, with the cap changed to **1,000** valid URLs (invalid rows are skipped and don't count).
- **4. Tracking progress:** unchanged text, plus: results already in the directory appear instantly.
- **5. Reading the results:** add the badges: **live** (fetched from Ahrefs just now), **cached** (from the directory, checked in the last 30 days), **stale** (Ahrefs was unavailable after 3 tries; showing the last known DR), and "checked N days ago". `error` with "No DR data from Ahrefs" means Ahrefs has no rating for that domain; this is remembered for 7 days.
- **6. Downloading results as CSV:** columns `url, domain, domain_rating, status, source, checked_at`.
- **7. Domain directory:** public, cross-user, latest DR per domain, filters/sort; domains with no data aren't listed.
- **8. Limits:** 100 typed / 1,000 CSV per check; 10 checks per minute per IP; 30-day cache; DR is per host.
- **9. FAQ:** replace "I lost my results link" with: check the domain again; anything checked in the last 30 days comes back instantly from the directory. Replace "Can I check the same domain twice?" with: yes, but within 30 days you'll get the cached DR. Add "I got 'Too many checks'": wait a minute.

- [ ] **Step 2: Update `CLAUDE.md`**

- "What this is": type domains or upload a CSV, no accounts, results sync live via Realtime broadcast, public domain directory doubles as a 30-day cache.
- Commands: add `npm test   # vitest (pure server/worker logic in tests/)`.
- Setup: fresh install = run `supabase/schema.sql`; existing project = run `supabase/migrations/20261007000000_domain_directory.sql`. Realtime must allow public channels.
- Architecture diagram: `POST /api/check` (rate limit → cache lookup → insert). The worker checks `domains` before Ahrefs and upserts after. Browser ← broadcast `batch:<id>`.
- Replace "Client sync" with the broadcast design (triggers `broadcast_url_change`/`broadcast_batch_change`, tables not anon-readable, subscribe-then-snapshot).
- Replace "Auth model" with "No accounts": batches are anonymous, the batch UUID is the key, all DB access is via `supabaseAdmin()`, RLS on with no policies, RPCs revoked from anon.
- Ahrefs section: fix normalization (only `www.` stripped, a dot is required); document `domains` TTLs (30d ok / 7d no_data, in `supabase/functions/_shared/cache.ts`), retries (3, `30s × attempts`), the 2-minute stuck-row reclaim, and `urls.source`.
- Key files: add `server/api/check.post.ts`, `server/utils/checkInput.ts`, `createCheck.ts`, `rateLimit.ts`, `supabase/functions/_shared/cache.ts`, `process-queue/outcome.ts`, `components/CheckResults.vue`, `specs/adr/`. Remove `upload.post.ts` and `generateCredentials`.

- [ ] **Step 3: Update `README.md`**

Update the intro line, the diagram (`POST /api/upload` → `POST /api/check`, no account creation), lines 37–43 (fast writes now = cache lookup + inserts, returns batch id + display mode) and the file list (`upload.post.ts` → `check.post.ts`; `pages/index.vue` = "Check form, inline results, domain directory").

- [ ] **Step 4: Verify that nothing stale remains**

Run: `grep -n -i "credential\|auto-generated account\|api/upload\|5,000\|5000\|domain_summary" CLAUDE.md README.md pages/docs.vue`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add pages/docs.vue CLAUDE.md README.md
git commit -m "docs: document lookup-first directory, cache, limits and no-account model"
```

---

## Rollout (human-run, after all tasks merge)

The migration and the new code must go live together: the old app breaks against the new schema, and the new app breaks against the old one.

1. Supabase dashboard → Realtime settings: make sure public channels are allowed ("Private channels only" **off**).
2. SQL editor: run `supabase/migrations/20261007000000_domain_directory.sql`, then the verification queries in Task 3 Step 3.
3. Deploy the worker: `supabase functions deploy process-queue --no-verify-jwt` (install the CLI first: `brew install supabase/tap/supabase`). The `_shared/` folder is bundled automatically.
4. Deploy to Netlify, then run Task 7 Step 4 against production, plus:
   - 11 rapid submits from one IP → the 11th returns 429;
   - with the anon key: `curl "$SUPABASE_URL/rest/v1/urls?select=*" -H "apikey: $SUPABASE_ANON_KEY"` → `[]` (and the same for `batches` and `domains`);
   - in the SQL editor, `update urls set status='processing', claimed_at=now()-interval '5 minutes' where id='<some done row>'` → within ~10s the cron backstop reclaims it;
   - a CSV with 1,001 valid rows → 400 "Max 1000 domains per check".
