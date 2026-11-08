# Contributing to DR Checker

Thanks for helping. Bug reports, fixes and small focused features are all welcome. For anything larger, open an issue first so we can agree on the approach before you write code.

## Getting set up

Follow [README → Setup](README.md#setup). You need Node 22 or newer (`nvm use` reads `.nvmrc`) and your own Supabase project. Most UI and server work only needs the three Supabase keys in `.env`. Worker changes also need an Ahrefs key.

## Making a change

1. **Branch from `main`** for every change. Please don't stack branches on other open PRs.
2. **Read the relevant ADR** in `specs/adr/` before changing a subsystem it covers (the domain directory, the worker trigger and secret, domain pages and metadata).
3. **Write or update a test first.** Unit tests live in `tests/` (Vitest). Keep logic in pure functions where you can, as `checkInput.ts`, `outcome.ts` and `domainsQuery.ts` do, so it stays testable.
4. **Run the gates** before you push. CI runs the same three:
   ```
   npm test
   npm run typecheck   # must report 0 errors
   npm run build
   ```
5. **Edge functions:** for each one you touch, also run `deno check supabase/functions/<fn>/index.ts`, then delete the `deno.lock` it creates. The edge entrypoints are excluded from `tsconfig.json`, so only `deno check` covers them.

## Database changes

- Every schema change is a new file in `supabase/migrations/`, mirrored into `supabase/schema.sql`, which is the end state for fresh installs.
- After applying it, run `npm run gen:types` and commit the regenerated `supabase/functions/_shared/database.types.ts`.
- Every table keeps RLS on with no policies, and every RPC keeps execute revoked from `public`, `anon` and `authenticated`. All access goes through the server's service-role client.
- SQL scenario tests (`supabase/tests/*.sql`) are a single `do` block that always ends by raising an exception, so nothing is kept. Success is the error text `SCENARIO OK`.

## Rules that keep the app safe

- Route every new outbound HTTP request through `supabase/functions/fetch-meta/safeFetch.ts`. It is the security boundary for outbound requests.
- Never increment batch progress counters from the app or the workers. Postgres owns batch status.
- Keep per-visitor data out of the server render of `/`, `/domains` and `/domain/*`, because those pages are cached by the CDN.
- Keep accessibility intact: visible focus, labels, and contrast that passes WCAG AA.

## Pull requests

- Keep each PR to one concern, with a title in the [Conventional Commits](https://www.conventionalcommits.org/) style (`feat:`, `fix:`, `docs:`, `chore:`, `style:`).
- Say why the change is needed, what changed, and how you verified it. The PR template has the sections.
- Add a line to `CHANGELOG.md` under **Unreleased** for anything a user would notice.

## Reporting bugs and security issues

Use the issue templates for bugs and feature ideas. Report security problems privately, as described in [SECURITY.md](SECURITY.md), never in a public issue.

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).
