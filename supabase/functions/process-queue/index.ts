// Invoked by:
//   1. A Database Webhook on `urls` INSERT (fast start)
//   2. A pg_cron backstop every ~10s (see schema.sql)
//
// Each invocation claims a small batch of pending url rows (using
// `FOR UPDATE SKIP LOCKED` so concurrent invocations never double-process
// the same row — this is what lets multiple batches / multiple users be
// processed in parallel safely), resolves each to a root domain, calls
// Ahrefs' free Domain Rating endpoint (de-duplicated per domain), and
// writes the result back. Table triggers roll the parent batch's
// progress/status up automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AHREFS_DR_RATING_KEY = Deno.env.get("AHREFS_DR_RATING")!;

const CLAIM_SIZE = 5; // urls claimed per invocation, keep small = gentle on Ahrefs' rate limit
const AHREFS_DELAY_MS = 300; // spacing between outbound Ahrefs calls

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDomainRating(
  domain: string,
): Promise<{ dr: number | null; error?: string }> {
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
    if (!res.ok) {
      return { dr: null, error: `Ahrefs HTTP ${res.status}` };
    }
    const data = await res.json();
    // Response shape: { domain_rating: { domain_rating: number, ... } } per Ahrefs docs
    const dr =
      data?.domain_rating?.domain_rating ?? data?.domain_rating ?? null;
    if (typeof dr !== "number") {
      return {
        dr: null,
        error: "No DR returned (domain may not exist / no backlink data)",
      };
    }
    return { dr };
  } catch (err) {
    return { dr: null, error: String(err) };
  }
}

Deno.serve(async () => {
  // 1. Claim a batch of pending rows atomically
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_pending_urls",
    {
      p_limit: CLAIM_SIZE,
    },
  );

  if (claimError) {
    console.error("claim error", claimError);
    return new Response(JSON.stringify({ error: claimError.message }), {
      status: 500,
    });
  }

  const rows = (claimed ?? []) as Array<{ id: string; domain: string }>;
  if (rows.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
  }

  // 2. De-dupe by domain so we only hit Ahrefs once per unique domain this run
  const domainCache = new Map<string, { dr: number | null; error?: string }>();

  for (const row of rows) {
    if (!domainCache.has(row.domain)) {
      const result = await fetchDomainRating(row.domain);
      domainCache.set(row.domain, result);
      await sleep(AHREFS_DELAY_MS);
    }
  }

  // 3. Write results back
  const updates = rows.map(async (row) => {
    const result = domainCache.get(row.domain)!;
    if (result.dr !== null) {
      return supabase
        .from("urls")
        .update({ dr: result.dr, status: "done" })
        .eq("id", row.id);
    } else {
      return supabase
        .from("urls")
        .update({
          status: "error",
          error_message: result.error ?? "Unknown error",
        })
        .eq("id", row.id);
    }
  });

  await Promise.all(updates);

  return new Response(JSON.stringify({ processed: rows.length }), {
    status: 200,
  });
});
