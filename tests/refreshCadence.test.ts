import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CACHE_TTL_DAYS } from "../supabase/functions/_shared/cache";

function refreshIntervalDays(path: string): number {
  const sql = readFileSync(path, "utf8");
  const body = sql.match(/function public\.enqueue_dr_refresh[\s\S]*?\$\$;/)?.[0] ?? "";
  return Number(body.match(/checked_at < now\(\) - interval '(\d+) days'/)?.[1]);
}

describe("directory refresh cadence", () => {
  for (const path of ["supabase/schema.sql", "supabase/migrations/20261107030000_dr_refresh.sql"]) {
    it(`re-checks a domain exactly when its cached DR stops being fresh (${path})`, () => {
      expect(refreshIntervalDays(path)).toBe(CACHE_TTL_DAYS);
    });
  }
});
