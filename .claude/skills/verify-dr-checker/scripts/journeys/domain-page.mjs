// /domain/<domain>: found (200 + SEO head), non-canonical spelling (301), unknown (404 + noindex).
// Read-only. Usage: node journeys/domain-page.mjs [domain]  (default: newest domain in the directory)
import { BASE, run } from "../lib.mjs";

await run("domain-page", async ({ page, open, check, proof, log }) => {
  let domain = process.argv[2];
  if (!domain) {
    const list = await (await fetch(`${BASE}/api/domains?pageSize=20&sortBy=checked_at&sortDir=desc`)).json();
    domain = list.domains[0]?.domain;
    check(!!domain, "directory has at least one domain");
  }
  log.push(`domain: ${domain}`);

  const found = await open(`/domain/${domain}`);
  check(found.status() === 200, `known domain is 200 (got ${found.status()})`);
  await page.getByRole("heading", { name: domain, level: 1 }).waitFor();
  check(/s-maxage=600/.test(found.headers()["cache-control"] ?? ""), "found page sends the CDN cache header");
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  check(canonical?.endsWith(`/domain/${domain}`), `canonical link ends with /domain/${domain} (got ${canonical})`);
  check((await page.locator('meta[name="robots"][content="noindex"]').count()) === 0, "found page is indexable");
  await page.getByRole("heading", { name: "DR over time" }).waitFor();
  await proof("01-found");

  // non-canonical spelling: the server must answer 301 to the canonical path
  const redirect = await fetch(`${BASE}/domain/WWW.${domain.toUpperCase()}`, { redirect: "manual" });
  check(redirect.status === 301, `non-canonical spelling is 301 (got ${redirect.status})`);
  check(redirect.headers.get("location")?.endsWith(`/domain/${domain}`), `301 points at /domain/${domain}`);

  const unknown = `verify-never-checked-${Date.now()}.example`;
  const missing = await open(`/domain/${unknown}`);
  check(missing.status() === 404, `unknown domain is 404 (got ${missing.status()})`);
  check((await page.locator('meta[name="robots"][content="noindex"]').count()) === 1, "unknown page is noindex");
  await page.getByRole("button", { name: "Check its DR now" }).waitFor();
  await proof("02-unknown");
});
