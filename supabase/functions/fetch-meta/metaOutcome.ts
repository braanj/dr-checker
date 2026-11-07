// The two ways a claimed domain finishes (ADR 0003). Both clear claimed_at
// and reset attempts: a finished claim must never look "stuck" to
// meta_due(), or the site would be refetched every 2 minutes.

const ERROR_MAX = 200;

export function metaSuccessFields(
  meta: { title: string | null; description: string | null },
  faviconPath: string | null,
  nowIso: string,
) {
  return {
    title: meta.title,
    description: meta.description,
    favicon_path: faviconPath,
    status: "ok" as const,
    error: null,
    fetched_at: nowIso,
    claimed_at: null,
    attempts: 0,
  };
}

export function metaErrorFields(reason: string, nowIso: string) {
  return {
    status: "error" as const,
    error: reason.slice(0, ERROR_MAX),
    fetched_at: nowIso,
    claimed_at: null,
    attempts: 0,
  };
}

// The previously stored favicon object to delete after a successful refresh
// that changed (or dropped) the path; otherwise null.
export function staleFaviconPath(previous: string | null, next: string | null): string | null {
  return previous && previous !== next ? previous : null;
}

// What storing a favicon produced: a new path, or none. `gone` is true only when
// every candidate got a real answer with no usable icon (4xx, not an image, empty);
// a timeout, network error, 5xx or upload failure is not proof the icon is gone.
export type FaviconOutcome = { path: string | null; gone: boolean };

// The favicon path to save after a successful page refresh: a flaky icon fetch
// keeps the last good icon instead of deleting it for 30 days.
export function keptFaviconPath(previous: string | null, outcome: FaviconOutcome): string | null {
  if (outcome.path) return outcome.path;
  return outcome.gone ? null : previous;
}
