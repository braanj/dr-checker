// Invoked (ADR 0003) by public.kick_meta_worker() via pg_net from the
// `fetch-meta` cron job (every minute, only when domains are due). Every call
// must carry `x-worker-secret`. Claims one due domain at a time (up to 5 per
// run, 60 s budget, 20 s hard deadline per domain), fetches its homepage
// through safeFetch, stores title/description and a favicon.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Database } from "../_shared/database.types.ts";
import { checkWorkerSecret } from "../_shared/auth.ts";
import { extractMeta, iconExtension, normalizeMime } from "./parseHead.ts";
import { combineLookups, FetchBlocked, fetchSite, META_LIMITS, safeFetch, type NetDeps } from "./safeFetch.ts";
import { metaErrorFields, metaSuccessFields, staleFaviconPath } from "./metaOutcome.ts";

const supabase = createClient<Database>(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const WORKER_SECRET = Deno.env.get("WORKER_SECRET");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const net: NetDeps = {
  // under the per-domain deadline; a non-NotFound failure on either family fails closed
  resolve: async (host, signal) => {
    const [a, aaaa] = await Promise.allSettled([
      Deno.resolveDns(host, "A", { signal }),
      Deno.resolveDns(host, "AAAA", { signal }),
    ]);
    return combineLookups(a, aaaa);
  },
  fetch: (url, init) => fetch(url, init),
};

async function storeFavicon(domain: string, candidates: string[], signal: AbortSignal): Promise<string | null> {
  for (const href of candidates.slice(0, META_LIMITS.iconCandidates)) {
    if (signal.aborted) break;
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
        .upload(path, icon.body, { upsert: true, contentType: normalizeMime(icon.contentType) });
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
    const { data: previous } = await supabase.from("domain_meta").select("favicon_path").eq("domain", domain).maybeSingle();
    const favicon_path = await storeFavicon(domain, meta.faviconCandidates, deadline);
    const { error: saveError } = await supabase
      .from("domain_meta")
      .update(metaSuccessFields(meta, favicon_path, new Date().toISOString()))
      .eq("domain", domain);
    // supabase-js returns (does not throw) errors; an unsaved success must
    // become an error outcome, or the claim would be retried every 2 minutes
    if (saveError) throw new Error(`save failed: ${saveError.message}`);
    // the favicon changed extension (or vanished): drop the old object
    const stale = staleFaviconPath(previous?.favicon_path ?? null, favicon_path);
    if (stale) {
      const { error: removeError } = await supabase.storage.from("favicons").remove([stale]);
      if (removeError) console.error("stale favicon removal failed", domain, removeError.message);
    }
    return "ok";
  } catch (err) {
    const reason = err instanceof FetchBlocked ? `blocked: ${err.message}` : String((err as Error)?.message ?? err);
    const { error: saveError } = await supabase
      .from("domain_meta")
      .update(metaErrorFields(reason, new Date().toISOString()))
      .eq("domain", domain);
    if (saveError) console.error("domain_meta error write failed", domain, saveError.message);
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
    if (error) return json({ ...counts, error: `claim failed: ${error.message}` }, 500);
    const domain = data?.[0];
    if (!domain) break;
    counts[await processDomain(domain)]++;
    counts.processed++;
  }
  return json(counts);
});
