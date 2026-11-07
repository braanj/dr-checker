# Domain page

`/domain/<domain>` is the public SEO page for one domain: its DR, when it was checked, the site's title and description ("From the site"), a favicon, and a "DR over time" chart and table. Unknown domains get a "We haven't checked … yet" page with a button to check them.

## Sub-features

- `dp-found` returns 200 with the title `<domain> Domain Rating (DR n) | DR Checker`, a description, `og:*` tags, `link rel=canonical`, and `Cache-Control: public, s-maxage=600…`.
- `dp-history` shows the "DR over time" table, plus a sparkline once there are two or more readings.
- `dp-canonical` answers a non-canonical spelling (`WWW.`, uppercase, percent-encoded) with a 301 to `/domain/<domain>`.
- `dp-unknown` answers an unchecked or `no_data` domain with a 404, `meta robots=noindex`, and a "Check its DR now" button.
- `dp-invalid` shows "That isn't a valid domain" for input without a dot.
- `dp-unavailable` answers a database failure with a 503 and no noindex (it can't be triggered locally without breaking Supabase).
- `dp-recheck` starts a check from the "Re-check" or "Check its DR now" button and shows inline results on the same page.

## How to get to it (user POV)

- Click a domain in the `/domains` table or in a check's results table.
- Type `/domain/<domain>` directly, or arrive from a search engine or `/sitemap.xml`.

## Driving it with Playwright

Preconditions:

- Baseline from the README. Pass a domain as an argument, or let the journey pick the most recently checked one.

- **Found.** Run `node scripts/journeys/domain-page.mjs [domain]`. The h1 is the domain, the status is 200, the cache header is set, the canonical ends in `/domain/<domain>`, there is no noindex, and "DR over time" is visible (`01-found`).
- **Canonical.** `fetch('/domain/WWW.<DOMAIN>', {redirect: 'manual'})` returns 301 with a `location` ending in `/domain/<domain>`.
- **Unknown.** `/domain/verify-never-checked-<ts>.example` returns 404 with noindex and the "Check its DR now" button (`02-unknown`). The journey never clicks the button: that would submit a made-up domain to Ahrefs.
- **Re-check.** Not scripted. Only click "Re-check" on a domain checked in the last 25 days, and assert as in `check.md`.

## Gotchas

- The expected 404 document shows up in `log.txt` as `console error: Failed to load resource … 404`. That is not a failure.
- The canonical URL comes from `SITE_URL` (the production host), not the local port.
- Title, description and favicon come from the `fetch-meta` worker, so new domains may have none yet. Don't require them.
- Never click "Check its DR now" on the unknown-domain page. It calls Ahrefs and can add a public page.
