// /domain/<domain> DR history chart: server-reserved box, canvas draws, tooltip on hover (desktop) and tap (phone).
// Read-only. Usage: node journeys/history-chart.mjs [domain]  (default: first directory domain with a DR change)
import { BASE, run } from "../lib.mjs";

// The chart is a canvas: read dot positions and the open tooltip from the live Chart.js instance.
async function chartState(page) {
  return page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").map((e) => e.name).find((n) => /chart/.test(n) && /\.js/.test(n));
    const { Chart } = await import(url);
    const c = Chart.getChart(document.querySelector("canvas"));
    return { dots: c.getDatasetMeta(0).data.map((e) => [e.x, e.y]), tooltip: c.tooltip.body?.[0]?.lines?.[0] ?? null };
  });
}

async function pointAt(page, i, touch) {
  const box = await page.locator("canvas").boundingBox();
  const { dots } = await chartState(page);
  const [x, y] = dots.at(i);
  if (touch) await page.touchscreen.tap(box.x + x, box.y + y);
  else await page.mouse.move(box.x + x, box.y + y);
  await page.waitForTimeout(200);
  return (await chartState(page)).tooltip;
}


await run("history-chart", async ({ page, context, dir, check, proof, log }) => {
  let domain = process.argv[2];
  if (!domain) {
    const list = await (await fetch(`${BASE}/api/domains?pageSize=100&sortBy=checked_at&sortDir=desc`)).json();
    domain = list.domains.find((d) => d.dr_change !== null)?.domain;
    check(!!domain, "directory has a domain with at least two readings");
  }
  log.push(`domain: ${domain}`);
  const label = `DR history for ${domain}`;

  const html = await (await fetch(`${BASE}/domain/${domain}`)).text();
  check(html.includes(`aria-label="${label}"`), "server HTML already holds the chart canvas");

  await page.goto(`${BASE}/domain/${domain}`, { waitUntil: "domcontentloaded" });
  const table = page.locator("table.data-table").first();
  const before = await table.boundingBox();
  await page.waitForFunction(() => document.querySelector("#__nuxt")?.__vue_app__?.$nuxt?.isHydrating === false);
  const canvas = page.getByRole("img", { name: label });
  await canvas.waitFor();
  await page.waitForFunction((l) => {
    const c = document.querySelector(`canvas[aria-label="${l}"]`);
    if (!c || !c.width) return false;
    const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < px.length; i += 4) if (px[i]) return true;
    return false;
  }, label);
  log.push("PASS canvas has drawn pixels");
  const after = await table.boundingBox();
  check(Math.abs(before.y - after.y) < 1, `readings table does not move when the chart draws (${before.y} → ${after.y})`);
  check((await page.locator("table.data-table tbody tr").count()) >= 2, "readings table still lists the readings");
  await proof("01-drawn");

  const tipLatest = await pointAt(page, -1, false);
  check(/^DR \d+ · \d{4}-\d{2}-\d{2}( · [+−]\d+)?$/.test(tipLatest ?? ""), `hover on the latest dot shows its tooltip (${tipLatest})`);
  await proof("02-hover-latest");
  const tipOldest = await pointAt(page, 0, false);
  check(/^DR \d+ · \d{4}-\d{2}-\d{2}$/.test(tipOldest ?? ""), `oldest dot's tooltip has no change (${tipOldest})`);
  await proof("03-hover-oldest");

  const phone = await context.browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mp = await phone.newPage();
  mp.on("pageerror", (e) => log.push(`page error (phone): ${e.message}`));
  await mp.goto(`${BASE}/domain/${domain}`);
  await mp.waitForFunction(() => document.querySelector("#__nuxt")?.__vue_app__?.$nuxt?.isHydrating === false);
  const mc = mp.getByRole("img", { name: label });
  const mbox = await mc.boundingBox();
  check(mbox.width <= 390 - 16, `chart fits the phone width (${mbox.width}px)`);
  const pageWidth = await mp.evaluate(() => document.documentElement.scrollWidth);
  check(pageWidth <= 390, `no horizontal page scroll on phone (${pageWidth}px)`);
  await mp.waitForFunction(() => document.querySelector("canvas")?.width > 0);
  const tipTap = await pointAt(mp, -1, true);
  check(tipTap === tipLatest, `tap on the latest dot shows the same tooltip on a phone (${tipTap})`);
  await mp.screenshot({ path: `${dir}/04-phone-tap.png`, fullPage: true });
  log.push("proof 04-phone-tap");
  await phone.close();
});
