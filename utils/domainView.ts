// Shape of GET /api/domain/:domain and the pure helpers the domain page uses.

export interface DomainMetaView {
  title: string | null;
  description: string | null;
  favicon_url: string | null;
}

export interface DomainView {
  domain: string;
  dr: number;
  checked_at: string;
  history: { dr: number; checked_at: string }[]; // newest first
  meta: DomainMetaView | null;
}

// "unknown" (404 + noindex) only for a real 404 or an invalid domain; any
// other failure is "unavailable" (503, no noindex) so a transient DB error
// never tells search engines to drop an indexed page.
export function domainPageState(
  view: DomainView | null | undefined,
  error: { statusCode?: number } | null | undefined,
): "found" | "unknown" | "unavailable" {
  if (view) return "found";
  if (!error || error.statusCode === 404) return "unknown";
  return "unavailable";
}

// One DR display rule for title, description and body.
export function formatDr(dr: number): string {
  return String(Math.round(dr));
}

// SITE_URL may be configured with a trailing slash; never emit `//domain/…`.
export function siteBase(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, "");
}

// The last good metadata stays visible even when the latest refresh errored
// (an error outcome never clears title/description/favicon_path).
export function metaViewFrom(
  row: { status: string | null; title: string | null; description: string | null; favicon_path: string | null } | null,
  supabaseUrl: string,
): DomainMetaView | null {
  if (!row || (!row.title && !row.description && !row.favicon_path)) return null;
  return {
    title: row.title,
    description: row.description,
    favicon_url: row.favicon_path
      ? `${supabaseUrl}/storage/v1/object/public/favicons/${encodeURIComponent(row.favicon_path)}`
      : null,
  };
}

const DESCRIPTION_MAX = 300;

function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function domainSeo(view: DomainView, siteUrl: string) {
  const dr = formatDr(view.dr);
  const base = `${view.domain} has an Ahrefs Domain Rating of ${dr} (checked ${view.checked_at.slice(0, 10)}).`;
  const description = view.meta?.description ? cap(`${base} ${view.meta.description}`, DESCRIPTION_MAX) : base;
  return {
    title: `${view.domain} Domain Rating (DR ${dr}) | DR Checker`,
    description,
    canonical: `${siteBase(siteUrl)}/domain/${view.domain}`,
  };
}

// SVG path for oldest→newest values; y grows downward, so higher DR is drawn higher.
export function sparklinePath(values: number[], width: number, height: number): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = width / (values.length - 1);
  const y = (v: number) => (max === min ? height / 2 : height - ((v - min) / (max - min)) * height);
  return values
    .map((v, i) => `${i === 0 ? "M" : "L"}${Math.round(i * step * 100) / 100},${Math.round(y(v) * 100) / 100}`)
    .join(" ");
}
