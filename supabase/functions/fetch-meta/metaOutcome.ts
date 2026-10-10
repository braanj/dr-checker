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
