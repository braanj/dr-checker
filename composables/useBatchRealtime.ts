// Live progress for one batch via Supabase Realtime *broadcast*: DB
// triggers (broadcast_url_change / broadcast_batch_change in schema.sql)
// push client-facing fields to the public channel `batch:<id>`. The tables
// themselves are not readable with the anon key. We subscribe *before*
// loading the /api/status snapshot so fast batches (cache hits, 1-domain
// checks) can't finish in the gap; rows already received live win over the
// snapshot.

import { useSupabase } from "./useSupabase";

export interface UrlRow {
  id: string;
  original_url: string;
  domain: string;
  dr: number | null;
  status: "pending" | "processing" | "done" | "error";
  error_message?: string | null;
  source: "live" | "cache" | "stale" | "no_data" | null;
  checked_at: string | null;
}

export interface BatchRow {
  id: string;
  filename: string;
  total_urls: number;
  processed_urls: number;
  status: "pending" | "processing" | "completed" | "failed";
}

type BatchProgress = Omit<BatchRow, "filename">;

const SUBSCRIBE_TIMEOUT_MS = 3000;

export function useBatchRealtime(batchId: string) {
  const supabase = useSupabase();

  const batch = ref<BatchRow | null>(null);
  const urls = ref<UrlRow[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  let channel: ReturnType<typeof supabase.channel> | null = null;
  let liveBatch: Partial<BatchProgress> = {};

  function upsertUrl(row: UrlRow) {
    const idx = urls.value.findIndex((u) => u.id === row.id);
    if (idx === -1) urls.value.push(row);
    else urls.value[idx] = row;
  }

  function subscribe(): Promise<void> {
    return new Promise((resolve) => {
      // Don't block first paint forever if websockets are blocked.
      const timer = setTimeout(resolve, SUBSCRIBE_TIMEOUT_MS);
      channel = supabase
        .channel(`batch:${batchId}`, { config: { private: false } })
        .on("broadcast", { event: "url" }, ({ payload }) => upsertUrl(payload as UrlRow))
        .on("broadcast", { event: "batch" }, ({ payload }) => {
          liveBatch = { ...liveBatch, ...(payload as BatchProgress) };
          if (batch.value) batch.value = { ...batch.value, ...liveBatch };
        })
        .subscribe((status) => {
          if (status !== "SUBSCRIBED" && status !== "CHANNEL_ERROR" && status !== "TIMED_OUT") return;
          clearTimeout(timer);
          resolve();
        });
    });
  }

  async function loadInitial() {
    try {
      const res = await $fetch<{ batch: BatchRow; urls: UrlRow[] }>(`/api/status/${batchId}`);
      const live = new Map(urls.value.map((u) => [u.id, u]));
      urls.value = res.urls.map((u) => live.get(u.id) ?? u);
      batch.value = { ...res.batch, ...liveBatch };
    } catch (e: any) {
      error.value = e?.data?.statusMessage ?? "Failed to load batch";
    } finally {
      loading.value = false;
    }
  }

  onMounted(async () => {
    await subscribe();
    await loadInitial();
  });

  onUnmounted(() => {
    if (channel) supabase.removeChannel(channel);
  });

  const progressPct = computed(() => {
    if (!batch.value || batch.value.total_urls === 0) return 0;
    return Math.round((batch.value.processed_urls / batch.value.total_urls) * 100);
  });

  return { batch, urls, loading, error, progressPct };
}
