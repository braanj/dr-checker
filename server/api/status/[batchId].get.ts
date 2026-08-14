// Polling fallback / initial page-load snapshot. The client's primary sync
// mechanism is the Supabase Realtime subscription (see
// composables/useBatchRealtime.ts); this route exists so the results page
// has something to render before the realtime channel connects, and as a
// graceful degrade if websockets are blocked.

import { supabaseAdmin } from "../../utils/supabaseAdmin";

export default defineEventHandler(async (event) => {
  const batchId = getRouterParam(event, "batchId");
  if (!batchId) {
    throw createError({ statusCode: 400, statusMessage: "Missing batchId" });
  }

  const admin = supabaseAdmin();

  const { data: batch, error: batchError } = await admin
    .from("batches")
    .select("*")
    .eq("id", batchId)
    .single();

  if (batchError || !batch) {
    throw createError({ statusCode: 404, statusMessage: "Batch not found" });
  }

  const { data: urls, error: urlsError } = await admin
    .from("urls")
    .select("id, original_url, domain, dr, status, error_message")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });

  if (urlsError) {
    throw createError({ statusCode: 500, statusMessage: urlsError.message });
  }

  return { batch, urls };
});
