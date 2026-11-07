// Home page typed check of one ALREADY-CACHED domain: submit, inline results, row done/cached.
// WRITES TO PRODUCTION: inserts one batch + one url row and one rate-limit row. It never calls
// Ahrefs because it refuses a domain whose cache is not fresh (< 25 days, safely inside the 30-day TTL).
// Usage: node journeys/check.mjs [domain]  (default: newest domain in the directory)
import { BASE, run } from "../lib.mjs";

await run("check", async ({ page, open, check, proof, log }) => {
  const list = await (await fetch(`${BASE}/api/domains?pageSize=100&sortBy=checked_at&sortDir=desc`)).json();
  const row = process.argv[2] ? list.domains.find((d) => d.domain === process.argv[2]) : list.domains[0];
  check(!!row, `cached domain found in the newest 100 (${process.argv[2] ?? "newest"})`);
  const ageDays = (Date.now() - Date.parse(row.checked_at)) / 86_400_000;
  check(ageDays < 25, `${row.domain} was checked ${ageDays.toFixed(1)} days ago (must be < 25 so no Ahrefs call)`);
  log.push(`domain: ${row.domain}, cached DR ${row.dr}`);

  await open("/");
  await page.getByRole("heading", { name: "Check Domain Rating" }).waitFor();
  await page.getByRole("textbox", { name: "Domains to check" }).fill(`https://www.${row.domain}/some/page`);
  await proof("01-filled");

  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/check") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Check DR" }).click(),
  ]);
  const body = await resp.json();
  check(resp.status() === 200, `POST /api/check is 200 (got ${resp.status()})`);
  check(body.display === "inline" && body.resolved === 1 && body.queued === 0, `answered from cache inline: ${JSON.stringify(body)}`);
  await page.waitForURL(new RegExp(`\\?check=${body.batchId}`));

  const resultRow = page.getByRole("row").filter({ hasText: row.domain });
  await resultRow.getByText("cached").waitFor();
  await page.getByText("Completed").waitFor();
  await page.getByRole("link", { name: "See all domains →" }).waitFor();
  await page.getByRole("heading", { name: "My recent checks" }).waitFor();
  await proof("02-result");

  // side effect: the stored batch matches what the page shows
  const status = await (await fetch(`${BASE}/api/status/${body.batchId}`)).json();
  check(status.batch.status === "completed" && status.batch.processed_urls === 1, "stored batch is completed 1/1");
  check(status.urls[0].domain === row.domain && status.urls[0].source === "cache", "stored url row is the cached domain");
  check(Number(status.urls[0].dr) === Number(row.dr), `stored DR ${status.urls[0].dr} equals directory DR ${row.dr}`);
  log.push(`batch: ${body.batchId}`);
});
