import { supabaseAdmin } from "../utils/supabaseAdmin";
import { buildSitemap, fetchAllOkDomains } from "../utils/sitemap";

export default defineEventHandler(async (event) => {
  const domains = await fetchAllOkDomains(supabaseAdmin());
  setResponseHeaders(event, {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, s-maxage=3600",
  });
  return buildSitemap(useRuntimeConfig().public.siteUrl as string, domains);
});
