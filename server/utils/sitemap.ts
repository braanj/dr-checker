// sitemap.xml / robots.txt builders (ADR 0003). PostgREST caps a select at
// max_rows (1,000), so domains are read page by page.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../supabase/functions/_shared/database.types";

type OkDomain = { domain: string; checked_at: string };

export async function fetchAllOkDomains(
  admin: SupabaseClient<Database>,
  pageSize = 1000,
): Promise<OkDomain[]> {
  const rows: OkDomain[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("domains")
      .select("domain, checked_at")
      .eq("status", "ok")
      .order("domain")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function buildSitemap(siteUrl: string, domains: OkDomain[]): string {
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

export function buildRobots(siteUrl: string): string {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /results/\nSitemap: ${siteUrl}/sitemap.xml\n`;
}
