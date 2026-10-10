import { buildRobots } from "../utils/sitemap";

export default defineEventHandler((event) => {
  setResponseHeaders(event, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=3600" });
  return buildRobots(useRuntimeConfig().public.siteUrl as string);
});
