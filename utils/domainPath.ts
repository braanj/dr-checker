// Canonical /domain/<domain> paths. The route param may arrive percent-encoded
// or in a non-canonical spelling; pages 301 to the canonical form.

import { normalizeDomain } from "../server/utils/domain";

export function resolveDomainParam(raw: string): { domain: string; canonical: boolean } | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const domain = normalizeDomain(decoded);
  if (!domain) return null;
  return { domain, canonical: raw === domain };
}

export function domainPath(domain: string): string {
  return `/domain/${domain}`;
}
