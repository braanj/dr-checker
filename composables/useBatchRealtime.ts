// Subscribes to Supabase Realtime for a single batch: live updates on the
// batch row itself (progress/status) and every url row that belongs to it.
// This is the "processing state synced with the server" requirement — no
// client-side polling loop needed.

import { useSupabase } from "./useSupabase";

export interface UrlRow {
  id: string;
  original_url: string;
  domain: string;
  dr: number | null;
  status: "pending" | "processing" | "done" | "error";
  error_message?: string | null;
}

export interface BatchRow {
  id: string;
  filename: string;
  total_urls: number;
  processed_urls: number;
  status: "pending" | "processing" | "completed" | "failed";
}

export function useBatchRealtime(batchId: string) {
  const supabase = useSupabase();

  const batch = ref<BatchRow | null>(null);
  const urls = ref<UrlRow[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  let channel: ReturnType<typeof supabase.channel> | null = null;

  async function loadInitial() {
    try {
      const res = await $fetch<{ batch: BatchRow; urls: UrlRow[] }>(
        `/api/status/${batchId}`,
      );
      batch.value = res.batch;
      urls.value = res.urls;
    } catch (e: any) {
      error.value = e?.data?.statusMessage ?? "Failed to load batch";
    } finally {
      loading.value = false;
    }
  }

  function upsertUrl(row: UrlRow) {
    const idx = urls.value.findIndex((u) => u.id === row.id);
    if (idx === -1) urls.value.push(row);
    else urls.value[idx] = row;
  }

  function subscribe() {
    channel = supabase
      .channel(`batch-${batchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "batches",
          filter: `id=eq.${batchId}`,
        },
        (payload) => {
          batch.value = payload.new as BatchRow;
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "urls",
          filter: `batch_id=eq.${batchId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          upsertUrl(payload.new as UrlRow);
        },
      )
      .subscribe();
  }

  onMounted(async () => {
    await loadInitial();
    subscribe();
  });

  onUnmounted(() => {
    if (channel) supabase.removeChannel(channel);
  });

  const progressPct = computed(() => {
    if (!batch.value || batch.value.total_urls === 0) return 0;
    return Math.round(
      (batch.value.processed_urls / batch.value.total_urls) * 100,
    );
  });

  return { batch, urls, loading, error, progressPct };
}
