// Invoked (ADR 0002) by public.kick_worker() via pg_net, from:
//   1. trg_urls_kick_worker — once per INSERT statement that adds pending rows
//   2. pg_cron every 10 s — only when rows are due
// Every call must carry `x-worker-secret` (see ./auth.ts). One call at a time
// holds the worker_lease row and drains the queue (./drain.ts): claim 5 due
// rows (FOR UPDATE SKIP LOCKED; stuck rows reclaimed after 2 minutes), answer
// from the `domains` cache when fresh, otherwise call Ahrefs once per domain
// with ≥300 ms between calls across the whole run. Decisions live in
// ./outcome.ts; table triggers roll batch progress up and broadcast changes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cachedUrlFields, isFresh, type DomainCacheRow } from "../_shared/cache.ts";
import type { Database, TablesUpdate } from "../_shared/database.types.ts";
import { checkWorkerSecret } from "../_shared/auth.ts";
import {
  AHREFS_TIMEOUT_MS,
  CLAIM_SIZE,
  drain,
  LEASE_TTL_SECONDS,
  type ClaimedRow,
  type DrainDeps,
} from "./drain.ts";
import {
  cacheWriteFor,
  classifyAhrefsResponse,
  GAVE_UP_MESSAGE,
  historyWriteFor,
  isExhausted,
  urlUpdateFor,
  type AhrefsResult,
} from "./outcome.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AHREFS_DR_RATING_KEY = Deno.env.get("AHREFS_DR_RATING")!;
const WORKER_SECRET = Deno.env.get("WORKER_SECRET");

const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

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

async function updateUrl(id: string, fields: TablesUpdate<"urls">) {
  const { error } = await supabase.from("urls").update(fields).eq("id", id);
  if (error) console.error("url update failed", id, error.message);
}

// One claimed batch: group by domain, answer fresh cache hits, finalize
// exhausted rows, otherwise one paced Ahrefs call per domain.
async function processBatch(rows: ClaimedRow[], pace: () => Promise<void>) {
  const byDomain = new Map<string, ClaimedRow[]>();
  for (const row of rows) byDomain.set(row.domain, [...(byDomain.get(row.domain) ?? []), row]);

  const { data: cacheRows, error: cacheError } = await supabase
    .from("domains")
    .select("domain, dr, status, checked_at")
    .in("domain", [...byDomain.keys()]);
  if (cacheError) console.error("cache read failed, calling Ahrefs for all", cacheError.message);
  // `status` is text + CHECK in Postgres, so the generated type is `string`.
  const cache = new Map(((cacheRows ?? []) as DomainCacheRow[]).map((c) => [c.domain, c]));

  const writes: PromiseLike<unknown>[] = [];

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

    await pace();
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

    for (const row of live) {
      writes.push(updateUrl(row.id, urlUpdateFor(result, row.attempts, previous, checkedAt)));
    }
  }

  await Promise.all(writes);
}

Deno.serve(async (req) => {
  const auth = checkWorkerSecret(req.headers.get("x-worker-secret"), WORKER_SECRET);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const holder = crypto.randomUUID();
  const deps: DrainDeps = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    acquireLease: async () => {
      const { data, error } = await supabase.rpc("acquire_worker_lease", {
        p_holder: holder,
        p_ttl_seconds: LEASE_TTL_SECONDS,
      });
      if (error) console.error("lease acquire failed", error.message);
      return !error && data === true;
    },
    releaseLease: async () => {
      const { error } = await supabase.rpc("release_worker_lease", { p_holder: holder });
      if (error) console.error("lease release failed (expires in 60 s)", error.message);
    },
    claim: async () => {
      const { data, error } = await supabase.rpc("claim_pending_urls", { p_limit: CLAIM_SIZE });
      if (error) throw new Error(`claim failed: ${error.message}`);
      return data ?? [];
    },
    processBatch,
  };

  try {
    return json(await drain(deps));
  } catch (err) {
    console.error("drain failed", err);
    return json({ error: String(err) }, 500);
  }
});
