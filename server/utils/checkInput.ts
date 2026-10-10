// Pure input handling for POST /api/check: parsing typed lists and CSVs,
// normalizing to domains, enforcing caps, and deciding which rows the
// `domains` cache can answer at insert time. No I/O here — the writes
// live in createCheck.ts.

import { normalizeDomain } from "./domain";
import { cachedUrlFields, isFresh, type DomainCacheRow } from "../../supabase/functions/_shared/cache";

export const TYPED_MAX = 100;
export const CSV_MAX = 1000;
export const INLINE_MAX = 10;

export type CheckSource = "typed" | "csv";

export class CheckInputError extends Error {}

export interface CheckRow {
  original_url: string;
  domain: string;
}

export interface PlannedUrl extends CheckRow {
  status: "pending" | "done" | "error";
  dr: number | null;
  source: "cache" | "no_data" | null;
  checked_at: string | null;
  error_message: string | null;
}

export function parseDomainList(text: string): string[] {
  return text
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseCsvUrls(text: string): string[] {
  const lines = text
    .replace(/^﻿/, "") // Excel's UTF-8 BOM would otherwise break header detection
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  // If the first cell is "url" (optionally quoted), treat it as a header.
  const looksLikeHeader = /^["']?url["']?$/i.test(lines[0].split(",")[0].trim());
  const dataLines = looksLikeHeader ? lines.slice(1) : lines;

  return dataLines
    .map((line) => line.split(",")[0].trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

// Normalizes every entry and enforces `max` on the *valid* rows only.
// Duplicates are kept: each submitted line gets its own result row.
export function buildCheckRows(raw: string[], max: number): { rows: CheckRow[]; skipped: number } {
  const rows = raw
    .map((original_url) => ({ original_url, domain: normalizeDomain(original_url) }))
    .filter((r): r is CheckRow => !!r.domain);

  if (rows.length === 0) throw new CheckInputError("No valid domains found");
  if (rows.length > max) {
    throw new CheckInputError(`Max ${max} domains per check (got ${rows.length})`);
  }

  return { rows, skipped: raw.length - rows.length };
}

export function planUrlRows(
  rows: CheckRow[],
  cache: DomainCacheRow[],
  now: Date,
): { planned: PlannedUrl[]; resolved: number } {
  const fresh = new Map(cache.filter((c) => isFresh(c, now)).map((c) => [c.domain, c]));
  let resolved = 0;

  const planned = rows.map((row): PlannedUrl => {
    const hit = fresh.get(row.domain);
    if (!hit) {
      return { ...row, status: "pending", dr: null, source: null, checked_at: null, error_message: null };
    }
    resolved++;
    return { ...row, ...cachedUrlFields(hit) };
  });

  return { planned, resolved };
}

// A batch is `pending` until the worker claims its first row (claim_pending_urls
// flips it to `processing`). Fully cache-answered batches are finished at
// insert time: `failed` when every row is an error, otherwise `completed` —
// the same rule bump_batch_progress applies when the worker finishes one.
export function initialBatchStatus(planned: PlannedUrl[]): "pending" | "completed" | "failed" {
  if (planned.some((p) => p.status === "pending")) return "pending";
  return planned.every((p) => p.status === "error") ? "failed" : "completed";
}

export function resultsDisplay(source: CheckSource, total: number): "inline" | "page" {
  return source === "typed" && total <= INLINE_MAX ? "inline" : "page";
}
