// Retry state for the results table: a `pending` row with attempts > 0 has
// already failed transiently and is waiting (backoff) for its next try.
// MAX_ATTEMPTS is the worker's own limit, so UI and worker never disagree.

import { MAX_ATTEMPTS } from "../supabase/functions/process-queue/outcome";

export function retryInfo(row: { status: string; attempts: number }): { attempt: number; of: number } | null {
  if (row.status !== "pending" || row.attempts <= 0) return null;
  return { attempt: row.attempts + 1, of: MAX_ATTEMPTS };
}
