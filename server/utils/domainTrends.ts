// Groups domain_trends RPC rows (newest first per domain) into DR series
// ordered oldest -> newest, one entry per requested domain.

export function groupTrends(
  domains: string[],
  rows: { domain: string; dr: number; checked_at: string }[],
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const d of domains) out[d] = [];
  for (const r of rows) out[r.domain]?.push(Number(r.dr));
  for (const d of domains) out[d].reverse();
  return out;
}
