import { supabaseAdmin } from "../../utils/supabaseAdmin";

type CsvRow = {
  original_url: string;
  domain: string;
  dr: number | null;
  status: string;
  source: string | null;
  checked_at: string | null;
};

function toCsv(rows: CsvRow[]) {
  const header = "url,domain,domain_rating,status,source,checked_at";
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [escape(r.original_url), escape(r.domain), r.dr ?? "", r.status, r.source ?? "", r.checked_at ?? ""].join(","),
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
    .select("original_url, domain, dr, status, source, checked_at")
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
