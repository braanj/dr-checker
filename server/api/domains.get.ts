// Public (no auth required): powers the /domains directory page.
// Reads the `domains` table (one row per domain, latest DR + check date +
// DR change) via the service-role client, since the table has no anon
// policies, and enriches the page with title/favicon (domain_meta) and a
// DR trend (domain_trends RPC).
// Only 'ok' rows are listed; 'no_data' rows are cache-only.

import { supabaseAdmin } from "../utils/supabaseAdmin";
import { parseDomainsQuery, DomainsQueryError, type DomainsResponse } from "../utils/domainsQuery";
import { groupTrends } from "../utils/domainTrends";
import { metaViewFrom } from "../../utils/domainView";

// Postgres LIKE/ILIKE treat literal `%`, `_`, and `\` as wildcards/escape
// chars even though postgrest-js parameterizes the value (no injection risk,
// just surprising matches without this).
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export default defineEventHandler(async (event): Promise<DomainsResponse> => {
  let p;
  try {
    p = parseDomainsQuery(getQuery(event));
  } catch (e) {
    if (e instanceof DomainsQueryError) throw createError({ statusCode: 400, statusMessage: e.message });
    throw e;
  }
  const { page, pageSize, sortBy, sortDir, domain: domainFilter, tld: tldFilter } = p;
  const { drMin, drMax, checkedFrom, checkedTo } = p;

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const admin = supabaseAdmin();

  let q = admin
    .from("domains")
    .select("domain, dr, checked_at, dr_change", { count: "exact" })
    .eq("status", "ok");

  if (domainFilter) q = q.ilike("domain", `%${escapeLike(domainFilter)}%`);
  // Suffix match only (last dot-separated label onward) — not eTLD-aware,
  // so e.g. tld=uk also matches example.co.uk. No public-suffix-list logic
  // in this codebase; see server/utils/domain.ts normalizeDomain, which
  // only strips a leading "www.", not all subdomains.
  if (tldFilter) q = q.ilike("domain", `%.${escapeLike(tldFilter)}`);
  if (drMin != null) q = q.gte("dr", drMin);
  if (drMax != null) q = q.lte("dr", drMax);
  if (checkedFrom) q = q.gte("checked_at", `${checkedFrom}T00:00:00.000Z`);
  if (checkedTo) q = q.lte("checked_at", `${checkedTo}T23:59:59.999Z`);

  let ordered = q.order(sortBy, {
    ascending: sortDir === "asc",
    ...(sortBy === "dr" || sortBy === "dr_change" ? { nullsFirst: false } : {}),
  });
  // Tiebreaker: many rows tie on dr/dr_change/checked_at, and without a
  // total order OFFSET/LIMIT pages can repeat or skip rows.
  if (sortBy !== "domain") ordered = ordered.order("domain", { ascending: true });
  const { data, error, count } = await ordered.range(from, to);

  if (error) {
    console.error("domains api: list query failed", error.message);
    throw createError({ statusCode: 500, statusMessage: error.message });
  }

  const rows = data ?? [];
  const total = count ?? 0;
  const pageDomains = rows.map((r) => r.domain);
  const metaByDomain = new Map<string, { title: string | null; favicon_url: string | null }>();
  let trends: Record<string, number[]> = {};

  if (pageDomains.length > 0) {
    const supabaseUrl = useRuntimeConfig().public.supabaseUrl as string;
    const [metaRes, trendRes] = await Promise.all([
      admin
        .from("domain_meta")
        .select("domain, title, description, favicon_path, status")
        .in("domain", pageDomains),
      admin.rpc("domain_trends", { p_domains: pageDomains, p_n: 12 }),
    ]);
    if (metaRes.error) {
      console.error("domains api: meta query failed", metaRes.error.message);
      throw createError({ statusCode: 500, statusMessage: metaRes.error.message });
    }
    if (trendRes.error) {
      console.error("domains api: trends query failed", trendRes.error.message);
      throw createError({ statusCode: 500, statusMessage: trendRes.error.message });
    }
    for (const m of metaRes.data ?? []) {
      const view = metaViewFrom(m, supabaseUrl);
      metaByDomain.set(m.domain, { title: view?.title ?? null, favicon_url: view?.favicon_url ?? null });
    }
    trends = groupTrends(pageDomains, trendRes.data ?? []);
  }

  return {
    domains: rows.map((r) => ({
      domain: r.domain,
      dr: r.dr,
      checked_at: r.checked_at,
      dr_change: r.dr_change,
      title: metaByDomain.get(r.domain)?.title ?? null,
      favicon_url: metaByDomain.get(r.domain)?.favicon_url ?? null,
      trend: trends[r.domain] ?? [],
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
});
