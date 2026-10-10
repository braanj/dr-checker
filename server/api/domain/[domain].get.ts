// Public: one domain's current DR and its history, for /domain/[domain].
// 404 unless the domain has an `ok` reading (no thin pages, ADR 0003).

import { supabaseAdmin } from "../../utils/supabaseAdmin";
import { normalizeDomain } from "../../utils/domain";
import { metaViewFrom, type DomainView } from "../../../utils/domainView";

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
  if (error) {
    console.error("domain api: query failed", domain, error.message);
    throw createError({ statusCode: 500, statusMessage: "Domain lookup failed" });
  }
  if (!row || row.dr === null) throw createError({ statusCode: 404, statusMessage: "Unknown domain" });

  const { data: history, error: historyError } = await admin
    .from("domain_history")
    .select("dr, checked_at")
    .eq("domain", domain)
    .order("checked_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (historyError) {
    console.error("domain api: query failed", domain, historyError.message);
    throw createError({ statusCode: 500, statusMessage: "Domain lookup failed" });
  }

  const { data: metaRow, error: metaError } = await admin
    .from("domain_meta")
    .select("title, description, favicon_path, status")
    .eq("domain", domain)
    .maybeSingle();
  if (metaError) {
    console.error("domain api: meta query failed", domain, metaError.message);
    throw createError({ statusCode: 500, statusMessage: "Domain lookup failed" });
  }

  const supabaseUrl = useRuntimeConfig().public.supabaseUrl as string;
  const meta = metaViewFrom(metaRow, supabaseUrl);

  return { domain: row.domain, dr: row.dr, checked_at: row.checked_at, history: history ?? [], meta };
});
