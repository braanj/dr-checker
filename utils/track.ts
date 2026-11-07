// Google Tag Manager dataLayer events. GTM is only injected when GTM_ID is
// set; without it the pushes land in a plain array nobody reads.

export interface Events {
  check_submitted: { source: "typed" | "csv"; rows: number };
  check_completed: { status: "completed" | "failed"; rows: number; seconds: number };
  results_csv_download: { rows: number };
  directory_export: { count: number };
}

type Target = { dataLayer?: unknown[] };

export function track<K extends keyof Events>(event: K, payload: Events[K], target: Target = globalThis as Target): void {
  if (target === globalThis && typeof window === "undefined") return;
  try {
    target.dataLayer ??= [];
    target.dataLayer.push({ event, ...payload });
  } catch {
    // analytics must never break the page
  }
}

// Only checks submitted from this tab are timed, so reopening an old
// results link never reports a completion.
const submitted = new Map<string, { submittedAt: number; rows: number }>();

export function noteSubmitted(batchId: string, rows: number, now = Date.now()): void {
  submitted.set(batchId, { submittedAt: now, rows });
}

export function trackCompleted(
  batchId: string,
  status: Events["check_completed"]["status"],
  now = Date.now(),
  target?: Target,
): void {
  const check = submitted.get(batchId);
  if (!check) return;
  submitted.delete(batchId);
  const seconds = Math.round((now - check.submittedAt) / 100) / 10;
  track("check_completed", { status, rows: check.rows, seconds }, target);
}
