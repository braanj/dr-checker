// Shared bits for journeys: browser, artifact folder, proof capture, assertions.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = execSync("git rev-parse --show-toplevel", { cwd: dirname(fileURLToPath(import.meta.url)) })
  .toString()
  .trim();

export const BASE = `http://127.0.0.1:${process.env.PORT ?? "3123"}`;

export async function start(feature) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(root, ".verify", "artifacts", feature, stamp);
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const log = [];
  page.on("console", (m) => m.type() === "error" && log.push(`console error: ${m.text()}`));
  page.on("pageerror", (e) => log.push(`page error: ${e.message}`));

  // SSR pages are clickable before Vue hydrates and clicks then do nothing: wait for hydration
  async function open(path) {
    const res = await page.goto(`${BASE}${path}`);
    await page.waitForFunction(() => document.querySelector("#__nuxt")?.__vue_app__?.$nuxt?.isHydrating === false);
    return res;
  }

  // ARIA snapshot + full-page screenshot, named by step
  async function proof(step) {
    writeFileSync(join(dir, `${step}.aria.yml`), await page.locator("body").ariaSnapshot());
    await page.screenshot({ path: join(dir, `${step}.png`), fullPage: true });
    log.push(`proof ${step}: ${page.url()}`);
  }
  function check(cond, msg) {
    log.push(`${cond ? "PASS" : "FAIL"} ${msg}`);
    if (!cond) throw new Error(msg);
  }
  async function finish(err) {
    writeFileSync(join(dir, "log.txt"), [...log, err ? `ERROR ${err.message}` : "DONE"].join("\n") + "\n");
    await browser.close();
    console.log(`${err ? "FAILED" : "PASSED"} ${feature} — artifacts: ${dir}`);
    process.exitCode = err ? 1 : 0;
  }
  return { page, context, dir, open, proof, check, finish, log };
}

export async function run(feature, journey) {
  const s = await start(feature);
  try {
    await journey(s);
    await s.finish();
  } catch (err) {
    await s.proof("failure").catch(() => {});
    await s.finish(err);
  }
}
