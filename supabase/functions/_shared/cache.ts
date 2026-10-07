// Cache rules shared by the Nitro server (server/utils/checkInput.ts) and
// the process-queue edge function. Keep this file dependency-free so both
// Node and Deno can import it.

export const CACHE_TTL_DAYS = 30;
export const NO_DATA_TTL_DAYS = 7;
export const NO_DATA_MESSAGE = "No DR data from Ahrefs";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DomainStatus = "ok" | "no_data";

export interface DomainCacheRow {
  domain: string;
  dr: number | null;
  status: DomainStatus;
  checked_at: string;
}

export interface CachedUrlFields {
  status: "done" | "error";
  dr: number | null;
  source: "cache" | "no_data";
  checked_at: string;
  error_message: string | null;
}

export function isFresh(row: Pick<DomainCacheRow, "status" | "checked_at">, now: Date): boolean {
  const ttlDays = row.status === "ok" ? CACHE_TTL_DAYS : NO_DATA_TTL_DAYS;
  return now.getTime() - new Date(row.checked_at).getTime() < ttlDays * DAY_MS;
}

// The url-row fields for a check answered from a fresh `domains` row.
export function cachedUrlFields(hit: DomainCacheRow): CachedUrlFields {
  if (hit.status === "ok") {
    return { status: "done", dr: hit.dr, source: "cache", checked_at: hit.checked_at, error_message: null };
  }
  return {
    status: "error",
    dr: null,
    source: "no_data",
    checked_at: hit.checked_at,
    error_message: NO_DATA_MESSAGE,
  };
}
