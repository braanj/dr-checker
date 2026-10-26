// Exports the selected directory domains as CSV. Order matches the check
// endpoint: validate the body, rate limit (own "export" bucket), then query.
// Lookups run in chunks so the PostgREST `in.(…)` URL stays short. Domains
// without an `ok` DR are skipped; request order is preserved.

import { useRuntimeConfig } from "#imports";
import { domainPath } from "../../../utils/domainPath";
import { siteBase } from "../../../utils/domainView";
import {
  buildDomainsCsv,
  ExportInputError,
  exportFilename,
  parseExportBody,
  type ExportRow,
} from "../../utils/domainsCsv";
import { assertRateLimit } from "../../utils/rateLimit";
import { supabaseAdmin } from "../../utils/supabaseAdmin";

const CHUNK = 200;

export default defineEventHandler(async (event) => {
  let domains: string[];
  try {
    domains = parseExportBody(await readBody(event));
  } catch (e) {
    if (e instanceof ExportInputError) {
      throw createError({ statusCode: 400, statusMessage: e.message });
    }
    throw e;
  }

  await assertRateLimit(event, "export");

  const db = supabaseAdmin();
  const drByDomain = new Map<string, { dr: number; checked_at: string; dr_change: number | null }>();
  const titleByDomain = new Map<string, string | null>();

  for (let i = 0; i < domains.length; i += CHUNK) {
    const chunk = domains.slice(i, i + CHUNK);
    const [dr, meta] = await Promise.all([
      db.from("domains").select("domain, dr, checked_at, dr_change").eq("status", "ok").in("domain", chunk),
      db.from("domain_meta").select("domain, title, description, favicon_path, status").in("domain", chunk),
    ]);
    if (dr.error || meta.error) {
      console.error(`domains export: ${(dr.error ?? meta.error)?.message}`);
      throw createError({ statusCode: 500, statusMessage: "Export failed" });
    }
    for (const r of dr.data ?? []) {
      if (r.dr === null) continue;
      drByDomain.set(r.domain, {
        dr: r.dr,
        checked_at: new Date(r.checked_at).toISOString(),
        dr_change: r.dr_change,
      });
    }
    for (const m of meta.data ?? []) titleByDomain.set(m.domain, m.title);
  }

  const base = siteBase(useRuntimeConfig().public.siteUrl as string);
  const rows: ExportRow[] = [];
  for (const domain of domains) {
    const r = drByDomain.get(domain);
    if (!r) continue;
    rows.push({
      domain,
      title: titleByDomain.get(domain) ?? null,
      dr: r.dr,
      dr_change: r.dr_change,
      checked_at: r.checked_at,
      page_url: base + domainPath(domain),
    });
  }

  setResponseHeaders(event, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${exportFilename(new Date())}"`,
    "Cache-Control": "no-store",
  });
  return buildDomainsCsv(rows);
});
