# Check DR

The home page ("Check Domain Rating") takes up to 100 typed domains, or a CSV of up to 1,000, and shows their DR. A typed check of 10 domains or fewer renders inline at `/?check=<batchId>`. Anything bigger redirects to `/results/<batchId>`. Results update live, can be downloaded as CSV, and the check is remembered under "My recent checks".

## Sub-features

- `chk-typed` submits the textbox "Domains to check" (comma- or newline-separated, URLs reduced to their host with `www.` dropped) and the "Check DR" button.
- `chk-csv` switches with "or upload a CSV" and uploads a file (first column; an optional `url` header row is skipped).
- `chk-inline` shows the results table inline for 10 typed rows or fewer, then "Completed" and "See all domains →".
- `chk-results-page` covers `/results/<batchId>` for CSV or larger typed checks, with the file name as the title.
- `chk-progress` shows "Queued…", "Processing…", "Completed" or "Failed" with an n / total counter and progress bar, updated over Realtime with a fallback to polling `/api/status`.
- `chk-badges` shows the row source as `live`, `cached` or `stale`, plus "retrying · attempt n of 3" and error text.
- `chk-download` downloads the results as CSV with "Download CSV" (`/api/download/<batchId>`).
- `chk-recent` lists past checks under "My recent checks" (localStorage) with "Clear".
- `chk-errors` shows "No valid domains found", "Max N domains per check", "Skipped N entries…" and "Too many checks — try again in a minute" (429).

## How to get to it (user POV)

- The sidebar link "Check", or the site root `/`.
- The "Re-check" or "Check its DR now" buttons on a domain page.
- A link from "My recent checks" or a shared `/results/<batchId>` URL.

## Driving it with Playwright

Preconditions:

- Baseline from the README. At least one domain in the newest 100 was checked in the last 25 days (the journey refuses otherwise).
- You accept that this writes one batch, one url row and one rate-limit row to production.

- **Typed inline check.** Run `node scripts/journeys/check.mjs [domain]`. It fills `Domains to check` with `https://www.<domain>/some/page` (`01-filled`) and clicks `Check DR`. `POST /api/check` returns 200 with `display: inline`, `resolved: 1`, `queued: 0`, and the URL becomes `/?check=<batchId>`.
- **Result.** The row for `<domain>` shows the badge `cached`. "Completed", "See all domains →" and "My recent checks" are visible (`02-result`).
- **Side effect.** `/api/status/<batchId>` shows the batch `completed` 1/1, and the url row has `source: cache` with a DR equal to the directory's.
- **Not yet scripted:** CSV upload and the results page, Download CSV, the progress states, live and retry badges, the error messages, and Clear. CSV and Download can be driven safely with a CSV of fresh cached domains (`page.setInputFiles` on the hidden file input after clicking "or upload a CSV"). Live, retry and stale badges need real Ahrefs calls, so verify them on production only.

## Gotchas

- This journey writes to production. Run it once per proof, not in a loop. 10 checks a minute per IP returns 429.
- Never submit an uncached or made-up domain. That calls Ahrefs (paid quota), and an `ok` result adds a public directory page and sitemap entry.
- The cache is fresh for 30 days for `ok` domains. The journey requires 25 days or less, so it never races the TTL.
- The file input is hidden inside a label. Use `setInputFiles` on `input[type=file]`, not a click.
- The inline results only exist while `?check=` is in the URL. Reloading `/` without it hides them.
