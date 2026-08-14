// Public (no auth required) — powers the "previously processed domains"
// table on the upload page. Reads from the domain_summary view (one row
// per unique domain, most recent DR + check date) via the service role
// client, since this is intentionally a cross-user, app-wide history and
// not gated by the per-user RLS policies on `urls`.

import { supabaseAdmin } from "../utils/supabaseAdmin";

const PAGE_SIZE = 20;

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = Math.max(1, parseInt((query.page as string) ?? "1", 10) || 1);

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const admin = supabaseAdmin();

  const { data, error, count } = await admin
    .from("domain_summary")
    .select("domain, dr, checked_at", { count: "exact" })
    .order("checked_at", { ascending: false })
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
