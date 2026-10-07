// The DB writes behind POST /api/check: read the `domains` cache for the
// submitted domains, insert the batch (pre-counting rows the cache already
// answers, since bump_batch_progress only fires on UPDATE), then insert the
// url rows. Pending rows trigger the process-queue webhook on insert.

import { supabaseAdmin } from "./supabaseAdmin";
import { planUrlRows, resultsDisplay, type CheckRow, type CheckSource } from "./checkInput";
import type { DomainCacheRow } from "../../supabase/functions/_shared/cache";

const LOOKUP_CHUNK = 200; // keeps the `in (...)` filter well under URL length limits
const INSERT_CHUNK = 500;

export interface CheckResponse {
  batchId: string;
  total: number;
  resolved: number;
  queued: number;
  skipped: number;
  display: "inline" | "page";
}

export async function createCheck(opts: {
  rows: CheckRow[];
  skipped: number;
  label: string;
  source: CheckSource;
}): Promise<CheckResponse> {
  const admin = supabaseAdmin();

  const uniqueDomains = [...new Set(opts.rows.map((r) => r.domain))];
  const cache: DomainCacheRow[] = [];
  for (let i = 0; i < uniqueDomains.length; i += LOOKUP_CHUNK) {
    const { data, error } = await admin
      .from("domains")
      .select("domain, dr, status, checked_at")
      .in("domain", uniqueDomains.slice(i, i + LOOKUP_CHUNK));
    if (error) {
      throw createError({ statusCode: 500, statusMessage: `Failed to read cache: ${error.message}` });
    }
    cache.push(...((data ?? []) as DomainCacheRow[]));
  }

  const { planned, resolved } = planUrlRows(opts.rows, cache, new Date());
  const total = planned.length;

  const { data: batch, error: batchError } = await admin
    .from("batches")
    .insert({
      filename: opts.label,
      total_urls: total,
      processed_urls: resolved,
      status: resolved === total ? "completed" : "processing",
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    throw createError({ statusCode: 500, statusMessage: `Failed to create batch: ${batchError?.message}` });
  }

  for (let i = 0; i < planned.length; i += INSERT_CHUNK) {
    const chunk = planned.slice(i, i + INSERT_CHUNK).map((p) => ({ batch_id: batch.id, ...p }));
    const { error: insertError } = await admin.from("urls").insert(chunk);
    if (insertError) {
      throw createError({ statusCode: 500, statusMessage: `Failed to insert URLs: ${insertError.message}` });
    }
  }

  return {
    batchId: batch.id as string,
    total,
    resolved,
    queued: total - resolved,
    skipped: opts.skipped,
    display: resultsDisplay(opts.source, total),
  };
}
