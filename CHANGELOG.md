# Changelog

Notable changes to DR Checker, newest first. The app is deployed continuously from `main`, so entries are grouped by merge date rather than by version.

## Unreleased

### Added

- Open-source project files: security policy, contributing guide, code of conduct, CI, issue and PR templates, this changelog.

### Changed

- The "DR over time" chart on domain pages is now a real chart: DR on a 0–100 axis, readings placed by date, and each reading's DR, date and change on hover or tap. Each dot, and the line leading to it, is colored by its DR band, like the directory bars, or red where DR declined.
- DR and DR changes show one decimal everywhere (domain page, chart, directory, page titles) instead of being rounded to whole numbers, so a DR of 0.2 no longer reads 0.

## 2026-11-08

### Added

- Tooltips on the terms and controls that aren't self-explanatory ([#34](https://github.com/braanj/DR-checker/pull/34))
- Land the reviewed UX stack (#28–#31) on main ([#32](https://github.com/braanj/DR-checker/pull/32))

### Changed

- Dense data-tool layout across the app ([#33](https://github.com/braanj/DR-checker/pull/33))

### Fixed

- Set the CDN cache header on the server only ([#35](https://github.com/braanj/DR-checker/pull/35))

## 2026-11-07

### Added

- Push GTM dataLayer events for checks and exports ([#27](https://github.com/braanj/DR-checker/pull/27))
- Re-check directory domains every 30 days with enqueue_dr_refresh ([#24](https://github.com/braanj/DR-checker/pull/24))

### Changed

- Note the sitemap's 50k limit and add a table-size check ([#20](https://github.com/braanj/DR-checker/pull/20))
- Drop unused papaparse and eslint, declare @types/node ([#19](https://github.com/braanj/DR-checker/pull/19))
- Add verify-dr-checker browser verification skill ([#13](https://github.com/braanj/DR-checker/pull/13))

### Fixed

- End a row on Ahrefs HTTP 400 instead of retrying ([#26](https://github.com/braanj/DR-checker/pull/26))
- Keep the last good DR when Ahrefs answers no_data ([#25](https://github.com/braanj/DR-checker/pull/25))
- Fix third audit: reject oversized input early, document hourly limit ([#23](https://github.com/braanj/DR-checker/pull/23))
- Fix second audit: storage-charge order, 404 polling, trailing dot, linear head parsing ([#22](https://github.com/braanj/DR-checker/pull/22))
- Fix audit findings: storage cap, 7-day results retention, favicon keep, worker test ([#21](https://github.com/braanj/DR-checker/pull/21))
- Guard formula triggers in the results CSV ([#18](https://github.com/braanj/DR-checker/pull/18))
- Keep one week of pg_cron run history ([#17](https://github.com/braanj/DR-checker/pull/17))
- Cap each IP's queued domains at 2,000 per hour ([#16](https://github.com/braanj/DR-checker/pull/16))
- Retry an unreadable Ahrefs 200 instead of caching no_data ([#15](https://github.com/braanj/DR-checker/pull/15))
- Encode non-ASCII names in Content-Disposition ([#14](https://github.com/braanj/DR-checker/pull/14))

## 2026-10-26

### Added

- App shell with sidebar, domains directory page, selection export ([#12](https://github.com/braanj/DR-checker/pull/12))

## 2026-10-18

### Changed

- CLAUDE.md reflects the current project state ([#11](https://github.com/braanj/DR-checker/pull/11))

## 2026-10-10

### Added

- Site favicon, title and description on domain pages (ADR 0003, Part B) ([#8](https://github.com/braanj/DR-checker/pull/8))
- Domain pages with DR history, SEO, sitemap and robots (ADR 0003, Part A) ([#7](https://github.com/braanj/DR-checker/pull/7))
- Retrying badge, batch start date, Retry-After on 429 ([#6](https://github.com/braanj/DR-checker/pull/6))
- Real pending/failed states ([#5](https://github.com/braanj/DR-checker/pull/5))
- Statement trigger, leased drain loop and Vault-held worker secret (ADR 0002) ([#3](https://github.com/braanj/DR-checker/pull/3))
- Public domain directory with a 30-day DR cache (ADR 0001) ([#1](https://github.com/braanj/DR-checker/pull/1))

### Changed

- Generated Supabase types, typed clients and a typecheck gate ([#4](https://github.com/braanj/DR-checker/pull/4))

### Fixed

- Deferred minor findings — fetch-meta hardening and private, receive-only broadcasts ([#10](https://github.com/braanj/DR-checker/pull/10))
- Deferred minor findings — web app (polling fallback, domain page, SEO, docs) ([#9](https://github.com/braanj/DR-checker/pull/9))
- Repair batch counters that drifted before the row-lock fix ([#2](https://github.com/braanj/DR-checker/pull/2))
