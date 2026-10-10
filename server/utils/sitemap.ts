// sitemap.xml / robots.txt builders (ADR 0003). PostgREST caps a select at
// max_rows (1,000), so domains are read page by page.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../supabase/functions/_shared/database.types";
import { siteBase } from "../../utils/domainView";

type OkDomain = { domain: string; checked_at: string };

export async function fetchAllOkDomains(
  admin: SupabaseClient<Database>,
  pageSize = 1000,
): Promise<OkDomain[]> {
  const rows: OkDomain[] = [];
  // stop only on an empty page: the server's max_rows may be smaller than pageSize
  for (let from = 0; ; ) {
    const { data, error } = await admin
      .from("domains")
      .select("domain, checked_at")
      .eq("status", "ok")
      .order("domain")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return rows;
    rows.push(...data);
    from += data.length;
  }
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function buildSitemap(rawSiteUrl: string, domains: OkDomain[]): string {
  const siteUrl = siteBase(rawSiteUrl);
  const urls = [
    `<url><loc>${escapeXml(`${siteUrl}/`)}</loc></url>`,
    `<url><loc>${escapeXml(`${siteUrl}/docs`)}</loc></url>`,
    ...domains.map(
      (d) =>
        `<url><loc>${escapeXml(`${siteUrl}/domain/${d.domain}`)}</loc><lastmod>${d.checked_at.slice(0, 10)}</lastmod></url>`,
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export function buildRobots(rawSiteUrl: string): string {
  const siteUrl = siteBase(rawSiteUrl);
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /results/\nSitemap: ${siteUrl}/sitemap.xml\n`;
}
