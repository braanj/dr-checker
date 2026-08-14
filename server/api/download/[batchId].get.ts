import { supabaseAdmin } from "../../utils/supabaseAdmin";

function toCsv(rows: Array<{ original_url: string; domain: string; dr: number | null; status: string }>) {
  const header = "url,domain,domain_rating,status";
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [escape(r.original_url), escape(r.domain), r.dr ?? "", r.status].join(",")
  );
  return [header, ...lines].join("\n");
}

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
    .select("original_url, domain, dr, status")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });

  if (urlsError || !urls) {
    throw createError({ statusCode: 500, statusMessage: urlsError?.message ?? "Failed to load results" });
  }

  const csv = toCsv(urls);
  const safeName = (batch.filename || "results").replace(/\.csv$/i, "");

  setResponseHeaders(event, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${safeName}-dr-results.csv"`,
  });

  return csv;
});
