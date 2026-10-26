// Pure helpers for the domains CSV export (no Nitro globals: the client imports
// EXPORT_MAX from here too).

import { normalizeDomain } from "./domain";

export const EXPORT_MAX = 1000;

export class ExportInputError extends Error {}

export function parseExportBody(body: unknown): string[] {
  const domains = (body as { domains?: unknown } | null)?.domains;
  if (!Array.isArray(domains)) {
    throw new ExportInputError("Expected JSON { domains: string[] }");
  }
  const seen = new Set<string>();
  for (const entry of domains) {
    if (typeof entry !== "string") continue;
    const d = normalizeDomain(entry);
    if (d) seen.add(d);
  }
  if (seen.size === 0) throw new ExportInputError("No valid domains to export");
  if (seen.size > EXPORT_MAX) {
    throw new ExportInputError(`At most ${EXPORT_MAX} domains per export`);
  }
  return [...seen];
}

export interface ExportRow {
  domain: string;
  title: string | null;
  dr: number;
  dr_change: number | null;
  checked_at: string;
  page_url: string;
}

// RFC 4180 quoting; strings starting with a formula trigger get a leading
// apostrophe so spreadsheets don't execute them. Numbers are never guarded.
export function csvCell(v: string | number | null): string {
  if (v === null) return "";
  if (typeof v === "number") return String(v);
  const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function buildDomainsCsv(rows: ExportRow[]): string {
  const lines = [
    "domain,title,dr,dr_change,checked_at,page_url",
    ...rows.map((r) =>
      [r.domain, r.title, r.dr, r.dr_change, r.checked_at, r.page_url].map(csvCell).join(","),
    ),
  ];
  return lines.join("\r\n");
}

export function exportFilename(now: Date): string {
  return `dr-domains-${now.toISOString().slice(0, 10)}.csv`;
}
