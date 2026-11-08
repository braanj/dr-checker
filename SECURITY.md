# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: [open a private report](https://github.com/braanj/DR-checker/security/advisories/new) (Security tab → "Report a vulnerability"). Include what you found, how to reproduce it, and the impact you expect. You should get a first reply within 7 days.

## Supported versions

Only the latest `main`, which is what https://dr-bulkchecker.netlify.app runs, gets security fixes.

## Scope

Areas where a report is especially useful:

- `supabase/functions/fetch-meta/safeFetch.ts` and `netguard.ts`, the boundary for every outbound request the app makes (SSRF, DNS rebinding, redirect or size-limit bypasses).
- Access to data through the anon key: Row Level Security, RPC grants, and the private Realtime channels.
- The per-IP rate limits on `/api/check` and `/api/domains/export`.
- CSV output (formula injection) and any HTML rendered from fetched site metadata.

Ahrefs' own API and Supabase's or Netlify's platforms are out of scope. Report issues with those to the vendor.
