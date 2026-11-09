---
name: verify-dr-checker
description: Drive the DR Checker web app (Nuxt UI at /, /domains, /domain/<domain>) in a real headless browser and capture proof that a change works for a user. Use after changing pages, components, server routes or anything user-visible, or when asked to "verify", "prove it works", "check it in the app" or "screenshot it".
---

# Verify DR Checker

Launch a local Nuxt dev server, drive it with Playwright the way a user does, and leave screenshots, ARIA snapshots and a pass/fail log as proof.

**Read this first: there is no local database.** The dev server uses the **production** Supabase project from `.env` (no Docker, no local stack). Everything you read is live data, and anything you write lands in production: the public directory, rate-limit rows and Ahrefs quota. So:

- `directory` and `domain-page` are safe. They only read, apart from one rate-limit row per export.
- `check` writes one real batch. It only ever submits a domain that is already cached, so Ahrefs is never called and the directory does not change. Never submit uncached or made-up domains: they call Ahrefs and can become public directory pages.
- Server-side changes to the edge functions (`process-queue`, `fetch-meta`) or SQL are **not** exercised by a local run, because production runs the deployed versions. Verify those on production per CLAUDE.md, not here.

All commands run from the repo root. `S=.claude/skills/verify-dr-checker/scripts`.

## Launch

One-time driver install (the browser library lives here, not in the app's `package.json`):

```bash
export PATH=$HOME/.nvm/versions/node/v24.16.0/bin:$PATH   # Node 24; Node 20 breaks every Supabase route
npm --prefix $S ci --no-audit --no-fund && (cd $S && npx playwright install chromium)
```

Start an instance (default port 3123, so it never collides with a `npm run dev` on 3000):

```bash
$S/launch.sh 3123
```

It prints `ready http://127.0.0.1:3123 (pid N)` once `GET /api/domains` answers 200. That only happens after Nitro has compiled and reached Supabase, so ready means usable. The first start takes 20–60 s. It refuses a port that is already in use. Logs go to `.verify/run/3123.log`.

Two instances can run side by side on different ports, but they share the same production database.

## Doctor

Read-only. Run it first, and again whenever anything looks off:

```bash
$S/doctor.sh 3123
```

Every line must start with `ok:`. It checks that the pid file exists and the process is ours, that it owns the port, which branch and commit is checked out (and whether it is dirty), the Node version, and that `/api/domains` returns a listing (it prints the row count and the Supabase URL). `FAIL:` means don't drive it. Run cleanup and launch again.

## Drive

Each journey is a standalone Playwright script. Set `PORT` to target another instance:

```bash
export PATH=$HOME/.nvm/versions/node/v24.16.0/bin:$PATH
node $S/journeys/directory.mjs            # /domains: sort, search, select, export CSV
node $S/journeys/domain-page.mjs [domain] # /domain/<d>: 200 + SEO, 301 canonical, 404 + noindex
node $S/journeys/history-chart.mjs [domain] # /domain/<d> chart: no layout shift, tooltip on hover and phone tap
node $S/journeys/check.mjs [domain]       # home typed check of a cached domain (writes 1 batch)
PORT=3124 node $S/journeys/directory.mjs
```

Each one prints `PASSED|FAILED <feature> — artifacts: <dir>` and exits 0 or 1.

When you write a new journey, copy one of these and keep to these rules:

- Navigate with `open(path)` from `lib.mjs`, not `page.goto`. Pages are server-rendered and look ready before Vue hydrates, and a click before hydration silently does nothing.
- After any action that refetches (sort, filter, page), wait for the `/api/domains?…` response and then assert on the rendered rows. The URL changes before the data does, so a URL wait alone proves nothing.
- Prefer roles and accessible names: `Search domains`, `Select <domain>`, region `Selection`, `Export selected`, textbox `Domains to check`, button `Check DR`, `Previous page`/`Next page`, `Page N`. The desktop table and the mobile card list both exist in the DOM. Use `getByRole` (it skips hidden elements) or add `:visible` to CSS locators.
- `check(cond, msg)` records PASS or FAIL and stops the journey. `proof(step)` writes `<step>.aria.yml` and `<step>.png`.

The feature map in `features/README.md` lists every feature, entry point and gotcha. Read the matching file before driving.

## Evidence

Artifacts go to `.verify/artifacts/<feature>/<timestamp>/` (gitignored): numbered `NN-step.png` and `NN-step.aria.yml` pairs, any downloaded files (such as the export CSV), and `log.txt` with every PASS/FAIL line, the URLs visited, and browser console or page errors. On failure there is also a `failure.png`/`failure.aria.yml` pair.

What counts as proof:

- Go through the real user path: the UI, or a public route a browser would hit. Never call RPCs, use the service-role key, or write to tables directly to set up state.
- Capture the action and the state it produces (before and after the step), not just the final screen.
- Check side effects next to the UI. A downloaded CSV's contents, or `/api/status/<batchId>` agreeing with what the page shows.
- Quote the PASS lines and the artifact folder in your report. An expected document 404 shows up in `log.txt` as `console error: … 404`, which is not a failure.

## Cleanup

```bash
$S/cleanup.sh 3123
```

This kills only the process tree in `.verify/run/3123.pid`, never by process name. It then confirms the port is free and keeps `.verify/artifacts/`. Run it after every run, including failed ones. Production rows written by `check` stay (they are ordinary check history); never delete them yourself.
