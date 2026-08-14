/**
 * Normalize an arbitrary user-submitted URL/domain string down to a bare
 * registrable-ish domain (e.g. "https://www.example.com/page?x=1" -> "example.com").
 * Ahrefs' free DR endpoint scores at the domain level, not per-page.
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
    return host || null;
  } catch {
    return null;
  }
}

const ADJECTIVES = ["swift", "bright", "quiet", "brave", "calm", "keen", "bold", "clear"];
const NOUNS = ["falcon", "harbor", "cedar", "comet", "meadow", "river", "summit", "quartz"];

export function generateCredentials() {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const suffix = Math.floor(1000 + Math.random() * 9000);
  const email = `${adjective}.${noun}.${suffix}@dr-checker.local`;

  // 16-char random password from a safe charset
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let password = "";
  for (let i = 0; i < 16; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }

  return { email, password };
}
