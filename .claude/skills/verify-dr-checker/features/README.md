# DR Checker verification map

This folder is the maintained source for verifying what users can do in DR Checker. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- An instance started by `scripts/launch.sh <port>` (default 3123) in this run, with every line of `scripts/doctor.sh <port>` starting `ok:`.
- Node 24 on `PATH` and the driver installed (`npm --prefix scripts ci`, then `npx playwright install chromium`).
- Data is live production data (no local database). The directory currently holds a few hundred `ok` domains, and at least one was checked in the last 25 days. Journeys pick their targets from the live list instead of hard-coding them.
- Never drive an instance this run did not start.

## Driving conventions

- Run every journey with `node scripts/journeys/<feature>.mjs`. Set `PORT=<port>` for a non-default instance.
- Navigate with `open()` from `lib.mjs` (waits for Vue hydration). After a refetching action, wait for the `/api/domains?…` response, then assert on the rows.
- Prefer roles and accessible names over CSS. Desktop table and mobile cards both exist in the DOM, so use `getByRole` or `:visible`.
- Only read, except where a feature file says it writes. Never submit a domain that is not already cached and fresh.

## Proof and skip reporting

- Each journey writes numbered screenshot + ARIA snapshot pairs and `log.txt` to `.verify/artifacts/<feature>/<timestamp>/`.
- Pair the UI state with a side effect: the export CSV's content, or `/api/status/<batchId>` for a check.
- Report the feature and entry point you used. Do not report an entry point as verified because a different one was driven.
- If a precondition is missing (for example, no domain checked in the last 25 days), report the journey as failed with that reason. Do not loosen the journey.

## Feature entry contract

Each feature file starts with an H1 and one paragraph describing the user-visible behavior, then exactly four H2s: `Sub-features`, `How to get to it (user POV)`, `Driving it with Playwright`, `Gotchas`.

## Features

- [Domain directory](./directory.md): browse, sort, filter, paginate, select and export `/domains`. Proven by `journeys/directory.mjs`.
- [Domain page](./domain-page.md): `/domain/<domain>` with DR history, SEO head, canonical redirect, and the unknown-domain state. Proven by `journeys/domain-page.mjs`; the DR history chart by `journeys/history-chart.mjs`.
- [Check DR](./check.md): typed and CSV checks from the home page, inline results, the results page, CSV download, recent checks. `journeys/check.mjs` covers the typed inline path and writes to production.
