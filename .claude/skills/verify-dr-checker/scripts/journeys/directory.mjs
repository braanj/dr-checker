// /domains: list, sort by DR, search, select a row, export selected as CSV.
// Read-only except the export, which logs one row in check_requests (rate-limit bucket "export").
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, run } from "../lib.mjs";

await run("directory", async ({ page, open, check, proof, dir, log }) => {
  const res = await open("/domains");
  check(res.status() === 200, `GET /domains is 200 (got ${res.status()})`);
  check(/s-maxage=60/.test(res.headers()["cache-control"] ?? ""), "SSR page sends the CDN cache header");
  await page.getByRole("heading", { name: "Domains", level: 1 }).waitFor();
  const firstLink = page.locator('a[href^="/domain/"]:visible').first();
  await firstLink.waitFor();
  await proof("01-list");

  // the URL changes before the data does: wait for the API answer, then for the table to show it
  const listed = (pred) => page.waitForResponse((r) => r.url().includes("/api/domains?") && pred(new URL(r.url())));
  const visibleRows = () =>
    page.locator("table tbody tr").evaluateAll((trs) =>
      trs.map((tr) => ({ domain: tr.querySelector('a[href^="/domain/"]')?.textContent.trim(), dr: Number(tr.cells[2]?.innerText) })),
    );

  await Promise.all([listed((u) => u.searchParams.get("sortBy") === "dr"), page.getByRole("button", { name: /^DR/ }).first().click()]);
  await page.waitForURL(/sortBy=dr(&|$)/);
  await page.waitForFunction(() => !document.querySelector("table.opacity-50, .opacity-50 table"));
  const sorted = await visibleRows();
  check(sorted.length > 1 && sorted.every((r, i) => i === 0 || sorted[i - 1].dr >= r.dr), `rows sorted by DR desc: ${sorted.slice(0, 5).map((r) => r.dr).join(",")}…`);
  await proof("02-sorted-by-dr");

  const target = sorted[1].domain; // not the first row, so the search visibly changes the list
  log.push(`target domain: ${target}`);
  await Promise.all([
    listed((u) => u.searchParams.get("domain") === target),
    page.getByRole("searchbox", { name: "Search domains" }).or(page.getByLabel("Search domains")).first().fill(target),
  ]);
  await page.waitForURL(new RegExp(`domain=${encodeURIComponent(target).replace(/\./g, "\\.")}`));
  await page.waitForFunction(() => !document.querySelector("table.opacity-50, .opacity-50 table"));
  const found = await visibleRows();
  check(found.length >= 1 && found.every((r) => r.domain.includes(target)), `every row matches "${target}" (${found.length} rows)`);
  await proof("03-searched");

  await page.getByRole("checkbox", { name: `Select ${target}` }).first().check();
  const bar = page.getByRole("region", { name: "Selection" });
  await bar.waitFor();
  check((await bar.textContent()).includes("1"), "selection bar shows 1 selected");
  await proof("04-selected");

  const [download] = await Promise.all([page.waitForEvent("download"), bar.getByRole("button", { name: /export/i }).click()]);
  const csvPath = join(dir, download.suggestedFilename());
  await download.saveAs(csvPath);
  const lines = readFileSync(csvPath, "utf8").trim().split(/\r\n/);
  check(lines[0] === "domain,title,dr,dr_change,checked_at,page_url", "CSV header matches the export contract");
  check(lines.length === 2 && lines[1].startsWith(`${target},`), `CSV has exactly one row for ${target}`);
});
