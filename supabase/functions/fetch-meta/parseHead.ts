// Dependency-free <head> reader (ADR 0003): title/description with Open
// Graph fallbacks, and ordered favicon candidates. Output is plain text.

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 500;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

function clean(raw: string | undefined, max: number): string | null {
  if (raw === undefined) return null;
  const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const inner = tag.replace(/^<\s*\w+/, "").replace(/\/?>$/, "");
  for (const m of inner.matchAll(ATTR)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

function headOf(html: string): string {
  const end = html.search(/<\/head\s*>/i);
  return end === -1 ? html : html.slice(0, end);
}

export function extractMeta(html: string, pageUrl: string) {
  const head = headOf(html);
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const metaValue = (key: "name" | "property", value: string) =>
    metas.find((a) => a[key]?.toLowerCase() === value)?.content;

  const title =
    clean(head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1], TITLE_MAX) ??
    clean(metaValue("property", "og:title"), TITLE_MAX);
  const description =
    clean(metaValue("name", "description"), DESCRIPTION_MAX) ??
    clean(metaValue("property", "og:description"), DESCRIPTION_MAX);

  const ranked: { href: string; rank: number; order: number }[] = [];
  [...head.matchAll(/<link\b[^>]*>/gi)].forEach((m, order) => {
    const a = attrs(m[0]);
    const rel = (a.rel ?? "").toLowerCase().split(/\s+/);
    if (!a.href) return;
    let rank: number;
    if (rel.includes("icon")) {
      const type = (a.type ?? "").toLowerCase();
      rank = /png|svg/.test(type) || /\.(png|svg)(\?|$)/i.test(a.href) ? 0 : 1;
    } else if (rel.includes("apple-touch-icon")) rank = 2;
    else return;
    ranked.push({ href: decodeEntities(a.href), rank, order });
  });

  const candidates: string[] = [];
  const add = (href: string) => {
    try {
      const url = new URL(href, pageUrl);
      if ((url.protocol === "http:" || url.protocol === "https:") && !candidates.includes(url.href)) {
        candidates.push(url.href);
      }
    } catch {
      // ignore unparseable hrefs
    }
  };
  ranked.sort((x, y) => x.rank - y.rank || x.order - y.order).forEach((c) => add(c.href));
  add("/favicon.ico");

  return { title, description, faviconCandidates: candidates };
}

const ICON_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export function iconExtension(contentType: string): string | null {
  return ICON_TYPES[contentType.split(";")[0].trim().toLowerCase()] ?? null;
}
