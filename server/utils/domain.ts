/**
 * Normalize an arbitrary user-submitted URL/domain string down to its host
 * (e.g. "https://www.example.com/page?x=1" -> "example.com"). Only a leading
 * "www." is stripped — other subdomains are kept — and hosts without a dot
 * are rejected. Ahrefs' free DR endpoint scores hosts, not individual pages.
 */
export function normalizeDomain(input: string): string | null {
  if (!input) return null;
  let value = input.trim();
  if (!value) return null;

  // Add a scheme if missing so URL() can parse it
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  try {
    const url = new URL(value);
    let host = url.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    // "localhost", bare words etc. can't have a DR — require at least one dot.
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}
