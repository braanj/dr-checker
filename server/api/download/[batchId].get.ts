import { attachmentHeader, buildResultsCsv } from "../../utils/domainsCsv";
import { supabaseAdmin } from "../../utils/supabaseAdmin";

export default defineEventHandler(async (event) => {
  const batchId = getRouterParam(event, "batchId");
  if (!batchId) {
    throw createError({ statusCode: 400, statusMessage: "Missing batchId" });
  }

  const admin = supabaseAdmin();

  const { data: batch, error: batchError } = await admin
    .from("batches")
    .select("id, filename, status")
    .eq("id", batchId)
    .single();

  if (batchError || !batch) {
    throw createError({ statusCode: 404, statusMessage: "Batch not found" });
  }

  const { data: urls, error: urlsError } = await admin
    .from("urls")
    .select("original_url, domain, dr, status, source, checked_at")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });

  if (urlsError || !urls) {
    throw createError({ statusCode: 500, statusMessage: urlsError?.message ?? "Failed to load results" });
  }

  const csv = buildResultsCsv(urls);
  const safeName = (batch.filename || "results").replace(/\.csv$/i, "");

  setResponseHeaders(event, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": attachmentHeader(`${safeName}-dr-results.csv`),
  });

  return csv;
});
