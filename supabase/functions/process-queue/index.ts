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
import {
  cacheWriteFor,
  classifyAhrefsResponse,
  GAVE_UP_MESSAGE,
  isExhausted,
  urlUpdateFor,
  type AhrefsResult,
} from "./outcome.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AHREFS_DR_RATING_KEY = Deno.env.get("AHREFS_DR_RATING")!;

const CLAIM_SIZE = 5; // urls claimed per invocation, keep small = gentle on Ahrefs' rate limit
const AHREFS_DELAY_MS = 300; // spacing between outbound Ahrefs calls
const AHREFS_TIMEOUT_MS = 20_000; // a hung call must not outlive the invocation

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
      signal: AbortSignal.timeout(AHREFS_TIMEOUT_MS),
    });
    const body = res.ok ? await res.json().catch(() => null) : null;
    return classifyAhrefsResponse(res.status, body);
  } catch (err) {
    return { kind: "transient", error: String(err) };
  }
}

async function updateUrl(id: string, fields: object) {
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
  const writes: PromiseLike<unknown>[] = [];
  let calledAhrefs = false;

  for (const [domain, domainRows] of byDomain) {
    const previous = cache.get(domain) ?? null;

    if (previous && isFresh(previous, new Date())) {
      for (const row of domainRows) writes.push(updateUrl(row.id, cachedUrlFields(previous)));
      continue;
    }

    const exhausted = domainRows.filter((row) => isExhausted(row.attempts));
    for (const row of exhausted) {
      const gaveUp: AhrefsResult = { kind: "transient", error: GAVE_UP_MESSAGE };
      writes.push(updateUrl(row.id, urlUpdateFor(gaveUp, row.attempts, previous, new Date())));
    }
    const live = domainRows.filter((row) => !isExhausted(row.attempts));
    if (live.length === 0) continue;

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

    for (const row of live) {
      writes.push(updateUrl(row.id, urlUpdateFor(result, row.attempts, previous, checkedAt)));
    }
  }

  await Promise.all(writes);

  return new Response(JSON.stringify({ processed: rows.length }), { status: 200 });
});
