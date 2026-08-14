// Accepts a multipart form with a `file` field (CSV of URLs, one per line
// or a column named "url"). Auto-creates a Supabase auth account, a batch
// row, and one url row per line. Processing itself is picked up by the
// process-queue edge function (webhook + cron), not here — this route just
// does fast writes and returns.

import { supabaseAdmin } from "../utils/supabaseAdmin";
import { normalizeDomain, generateCredentials } from "../utils/domain";

function parseCsvUrls(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  // If the first line looks like a header (contains "url" and no dots/scheme),
  // treat column 1 as the url column and skip it as data.
  const looksLikeHeader = /^["']?url["']?$/i.test(lines[0].split(",")[0].trim());
  const dataLines = looksLikeHeader ? lines.slice(1) : lines;

  return dataLines
    .map((line) => line.split(",")[0].trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

export default defineEventHandler(async (event) => {
  const form = await readMultipartFormData(event);
  if (!form) {
    throw createError({ statusCode: 400, statusMessage: "Expected multipart/form-data with a 'file' field" });
  }

  const filePart = form.find((p) => p.name === "file");
  if (!filePart) {
    throw createError({ statusCode: 400, statusMessage: "Missing 'file' field" });
  }

  const csvText = filePart.data.toString("utf-8");
  const rawUrls = parseCsvUrls(csvText);

  if (rawUrls.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "CSV contained no URLs" });
  }
  if (rawUrls.length > 5000) {
    throw createError({ statusCode: 400, statusMessage: "Max 5000 URLs per upload" });
  }

  const admin = supabaseAdmin();

  // 1. Auto-create the account
  const { email, password } = generateCredentials();
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no confirmation email required — credentials are handed back directly
  });

  if (authError || !authData?.user) {
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to create account: ${authError?.message ?? "unknown error"}`,
    });
  }

  const userId = authData.user.id;

  // 2. Build normalized url rows, dropping unparseable entries
  const rows = rawUrls
    .map((raw) => ({ original_url: raw, domain: normalizeDomain(raw) }))
    .filter((r): r is { original_url: string; domain: string } => !!r.domain);

  if (rows.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "No valid URLs found in CSV" });
  }

  // 3. Create the batch
  const { data: batch, error: batchError } = await admin
    .from("batches")
    .insert({
      user_id: userId,
      filename: filePart.filename ?? "upload.csv",
      total_urls: rows.length,
      status: "processing",
    })
    .select()
    .single();

  if (batchError || !batch) {
    throw createError({ statusCode: 500, statusMessage: `Failed to create batch: ${batchError?.message}` });
  }

  // 4. Insert url rows (chunked to stay under payload limits)
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({
      batch_id: batch.id,
      user_id: userId,
      original_url: r.original_url,
      domain: r.domain,
      status: "pending",
    }));
    const { error: insertError } = await admin.from("urls").insert(chunk);
    if (insertError) {
      throw createError({ statusCode: 500, statusMessage: `Failed to insert URLs: ${insertError.message}` });
    }
  }

  // Insert triggers the Database Webhook -> process-queue edge function
  // automatically; the pg_cron backstop covers the rest. Nothing else to do here.

  return {
    batchId: batch.id,
    totalUrls: rows.length,
    skipped: rawUrls.length - rows.length,
    credentials: { email, password },
  };
});
