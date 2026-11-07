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
  const text = decodeEntities(raw)
    // control characters (incl. NUL, which Postgres text rejects); \t \n \r become spaces below
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : null;
}

const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const inner = tag.replace(/^<\s*\w+/, "").replace(/\/?>$/, "");
  for (const m of inner.matchAll(ATTR)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

// Every `<name …>` tag, in one linear pass. Quote-aware: a `>` inside a quoted
// attribute value doesn't end the tag. A tag that never closes ends the scan:
// nothing after it can be a complete tag (a backtracking regex here took time
// quadratic in the head size on crafted input, ~100 s at the 512 KB cap).
function tagsOf(head: string, name: string): string[] {
  const tags: string[] = [];
  const open = new RegExp(`<${name}\\b`, "gi");
  for (let m = open.exec(head); m; m = open.exec(head)) {
    let quote = "";
    let i = m.index + m[0].length;
    for (; i < head.length; i++) {
      const c = head[i];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (i >= head.length) break;
    tags.push(head.slice(m.index, i + 1));
    open.lastIndex = i + 1;
  }
  return tags;
}

// the text of the first <title>…</title>, found with linear searches only
function titleOf(head: string): string | undefined {
  const open = head.search(/<title\b/i);
  if (open === -1) return undefined;
  const start = head.indexOf(">", open) + 1;
  if (start === 0) return undefined;
  const end = head.slice(start).search(/<\/title\s*>/i);
  return end === -1 ? undefined : head.slice(start, start + end);
}

function headOf(html: string): string {
  const end = html.search(/<\/head\s*>/i);
  return end === -1 ? html : html.slice(0, end);
}

export function extractMeta(html: string, pageUrl: string) {
  const head = headOf(html);
  const metas = tagsOf(head, "meta").map(attrs);
  const metaValue = (key: "name" | "property", value: string) =>
    metas.find((a) => a[key]?.toLowerCase() === value)?.content;

  const title =
    clean(titleOf(head), TITLE_MAX) ??
    clean(metaValue("property", "og:title"), TITLE_MAX);
  const description =
    clean(metaValue("name", "description"), DESCRIPTION_MAX) ??
    clean(metaValue("property", "og:description"), DESCRIPTION_MAX);

  const ranked: { href: string; rank: number; order: number }[] = [];
  tagsOf(head, "link").forEach((tag, order) => {
    const a = attrs(tag);
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

export function normalizeMime(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

export function iconExtension(contentType: string): string | null {
  return ICON_TYPES[normalizeMime(contentType)] ?? null;
}
