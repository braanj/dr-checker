# Domain directory

`/domains` lists every domain with a DR: favicon, title, DR bar, DR change, trend sparkline, and "checked N days ago". Users sort, filter, page through it, select domains (the selection survives page changes) and export the selection as CSV.

## Sub-features

- `dir-list` shows rows plus an "N domains" count and sends `Cache-Control: public, s-maxage=60…`.
- `dir-sort` sorts by Domain, DR, Δ (change) or Checked. Clicking the active column flips the direction. A new column starts desc (Domain starts asc).
- `dir-search` filters by "Search domains" (substring), "Minimum DR"/"Maximum DR", "TLD", and Checked from/to under "More filters". Active filters show as removable chips and "Clear all".
- `dir-page` uses Prev/Next, "Page N" and "Rows per page" (20/50/100).
- `dir-select` uses row checkboxes "Select <domain>" and the header "Select all domains on this page". The selection is capped at 1,000 and persists in sessionStorage.
- `dir-export` downloads the selection as `dr-domains-YYYY-MM-DD.csv` via "Export selected".
- `dir-empty` shows "No domains match these filters." with "Clear filters", and "This page is out of range." with "Go to page 1".

## How to get to it (user POV)

- Sidebar link "Domains" from any page.
- "See all domains →" under a completed inline check on the home page.
- Typing a URL with a query, such as `/domains?sortBy=dr&domain=google`. The state lives entirely in the URL.

## Driving it with Playwright

Preconditions:

- Baseline from the README. The directory has at least 2 domains.

- **List.** Run `node scripts/journeys/directory.mjs`. `01-list` shows heading `Domains`, a table, and a status 200 with the s-maxage header.
- **Sort.** The journey clicks the button named `DR` and waits for `/api/domains?…sortBy=dr`. The PASS line lists the first DR values in non-increasing order (`02-sorted-by-dr`).
- **Search.** It fills `Search domains` with the second row's domain and waits for the `domain=` response. Every visible row contains that text (`03-searched`).
- **Select.** It checks `Select <domain>`. Region `Selection` appears showing "1 selected" (`04-selected`).
- **Export.** It clicks `Export selected` and saves the download into the artifact folder. The first line is `domain,title,dr,dr_change,checked_at,page_url` and there is exactly one data row for the domain.
- **Not yet scripted:** DR min/max, TLD, the date filters, chips, pagination and rows per page, select all on a page, the 1,000 cap, and the empty and out-of-range states. Drive them by copying the journey and using the accessible names above.

## Gotchas

- The URL updates before the data. Waiting on the URL alone proves nothing, so wait for the `/api/domains` response.
- While refetching, the table gets `opacity-50`. Snapshot after it clears.
- In dev mode, a click before hydration is ignored. Always navigate with `open()`.
- Each export inserts one `export` rate-limit row in production. More than 10 exports a minute from one IP returns 429 ("Too many exports").
- Search, DR and date filters are debounced. Wait for the response, not a fixed sleep.
- Many domains share a DR, so a DR-sorted page is not stable across runs. The tiebreaker is domain name ascending.
