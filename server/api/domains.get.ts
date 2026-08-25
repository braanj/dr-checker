// Public (no auth required) — powers the "previously processed domains"
// table on the upload page. Reads from the domain_summary view (one row
// per unique domain, most recent DR + check date) via the service role
// client, since this is intentionally a cross-user, app-wide history and
// not gated by the per-user RLS policies on `urls`.

import { supabaseAdmin } from "../utils/supabaseAdmin";

const PAGE_SIZE = 20;

const SORT_COLUMNS = new Set(["checked_at", "domain", "dr"]);
const SORT_DIRS = new Set(["asc", "desc"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Postgres LIKE/ILIKE treat literal `%`, `_`, and `\` as wildcards/escape
// chars even though postgrest-js parameterizes the value (no injection risk,
// just surprising matches without this).
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function parseNumber(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = Math.max(1, parseInt((query.page as string) ?? "1", 10) || 1);

  const sortBy = ((query.sortBy as string) ?? "checked_at").trim();
  if (!SORT_COLUMNS.has(sortBy)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid sortBy: ${sortBy}` });
  }

  const sortDir = ((query.sortDir as string) ?? "desc").trim();
  if (!SORT_DIRS.has(sortDir)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid sortDir: ${sortDir}` });
  }

  const domainFilter = typeof query.domain === "string" ? query.domain.trim() : "";
  const tldFilter =
    typeof query.tld === "string" ? query.tld.trim().replace(/^\.+/, "").toLowerCase() : "";
  const drMin = parseNumber(query.drMin);
  const drMax = parseNumber(query.drMax);
  const checkedFrom = parseDate(query.checkedFrom);
  const checkedTo = parseDate(query.checkedTo);

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const admin = supabaseAdmin();

  let q = admin.from("domain_summary").select("domain, dr, checked_at", { count: "exact" });

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

  const { data, error, count } = await q
    .order(sortBy, {
      ascending: sortDir === "asc",
      ...(sortBy === "dr" ? { nullsFirst: false } : {}),
    })
    .range(from, to);

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message });
  }

  const total = count ?? 0;

  return {
    domains: data ?? [],
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
});
