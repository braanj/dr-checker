// Pure decisions for the process-queue worker: how to read an Ahrefs
// response, what to write to the url row, and what (if anything) to cache
// in `domains`. Kept free of Deno/Supabase imports so Vitest can test it.

import { NO_DATA_MESSAGE, type DomainCacheRow, type DomainStatus } from "../_shared/cache.ts";
import type { TablesUpdate } from "../_shared/database.types.ts";

export const MAX_ATTEMPTS = 3;
export const BACKOFF_SECONDS = 30;
export const GAVE_UP_MESSAGE = "Gave up after repeated worker failures";

// A row past MAX_ATTEMPTS only gets here by being reclaimed after its
// worker died mid-run (e.g. a hung fetch). Finalize it without calling
// Ahrefs again, or it would be retried forever.
export function isExhausted(attempts: number): boolean {
  return attempts > MAX_ATTEMPTS;
}

export type AhrefsResult =
  | { kind: "ok"; dr: number }
  | { kind: "no_data" }
  | { kind: "transient"; error: string };

export function classifyAhrefsResponse(httpStatus: number, body: unknown): AhrefsResult {
  if (httpStatus !== 200) return { kind: "transient", error: `Ahrefs HTTP ${httpStatus}` };
  // Response shape: { domain_rating: { domain_rating: number, ... } } per Ahrefs docs
  const data = body as any;
  const dr = data?.domain_rating?.domain_rating ?? data?.domain_rating;
  return typeof dr === "number" ? { kind: "ok", dr } : { kind: "no_data" };
}

// Transient failures are never cached, so a rate-limit blip can't poison
// the directory.
export function cacheWriteFor(result: AhrefsResult): { dr: number | null; status: DomainStatus } | null {
  if (result.kind === "ok") return { dr: result.dr, status: "ok" };
  if (result.kind === "no_data") return { dr: null, status: "no_data" };
  return null;
}

// Only real readings become history; no_data and transient results never do.
export function historyWriteFor(result: AhrefsResult): { dr: number } | null {
  return result.kind === "ok" ? { dr: result.dr } : null;
}

// `attempts` includes the current try (claim_pending_urls increments it).
export function urlUpdateFor(
  result: AhrefsResult,
  attempts: number,
  previous: DomainCacheRow | null,
  now: Date,
): TablesUpdate<"urls"> {
  if (result.kind === "ok") {
    return { status: "done", dr: result.dr, source: "live", checked_at: now.toISOString(), error_message: null };
  }
  if (result.kind === "no_data") {
    return { status: "error", dr: null, source: "no_data", checked_at: now.toISOString(), error_message: NO_DATA_MESSAGE };
  }
  if (attempts < MAX_ATTEMPTS) {
    return {
      status: "pending",
      available_at: new Date(now.getTime() + BACKOFF_SECONDS * 1000 * attempts).toISOString(),
      error_message: result.error,
    };
  }
  if (previous?.status === "ok" && previous.dr !== null) {
    return { status: "done", dr: previous.dr, source: "stale", checked_at: previous.checked_at, error_message: null };
  }
  return { status: "error", dr: null, source: null, checked_at: null, error_message: result.error };
}
