// Shared-secret check for the process-queue worker (ADR 0002). Postgres
// (kick_worker via pg_net) sends `x-worker-secret`; the function compares it
// with its WORKER_SECRET in constant time. Pure, so Vitest can test it.

export type AuthResult = { ok: true } | { ok: false; status: 401 | 500; error: string };

function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function checkWorkerSecret(header: string | null, expected: string | undefined): AuthResult {
  if (!expected) return { ok: false, status: 500, error: "worker not configured" };
  if (!header || !constantTimeEqual(header, expected)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true };
}
