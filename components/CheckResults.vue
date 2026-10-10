<template>
  <div>
    <div v-if="loading" class="mt-6 text-[#86868b]">Loading results…</div>
    <div v-else-if="error" class="mt-6 text-red-600">{{ error }}</div>

    <template v-else-if="batch">
      <h1 v-if="showTitle" class="mt-4 text-3xl font-semibold tracking-tight text-[#1d1d1f]">{{ batch.filename }}</h1>

      <div class="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <div class="flex justify-between text-sm text-[#6e6e73] mb-2">
          <span>{{ statusLabel }}</span>
          <span>{{ batch.processed_urls }} / {{ batch.total_urls }}</span>
        </div>
        <p v-if="batch.created_at" class="-mt-1 mb-2 text-xs text-[#86868b]">
          Started {{ new Date(batch.created_at).toLocaleString() }}
        </p>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-black/5">
          <div class="h-full rounded-full transition-all duration-300"
            :class="batch.status === 'failed' ? 'bg-red-500' : 'bg-accent'" :style="{ width: progressPct + '%' }" />
        </div>
        <p v-if="batch.status === 'failed'" class="mt-3 text-sm text-red-600">
          None of these domains could be checked — see the errors below.
        </p>
      </div>

      <button v-if="batch.processed_urls"
        class="mt-6 rounded-full bg-[#1d1d1f] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-black"
        @click="download">
        Download CSV
      </button>

      <div class="mt-8 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[560px] text-sm border-collapse">
            <thead>
              <tr class="text-left text-[#6e6e73] border-b border-black/5">
                <th class="py-3 px-4 font-medium">URL</th>
                <th class="py-3 px-4 font-medium">Domain</th>
                <th class="py-3 px-4 font-medium">DR</th>
                <th class="py-3 px-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in sortedUrls" :key="row.id"
                class="border-b border-black/5 last:border-0 transition-colors hover:bg-black/[0.02]">
                <td class="py-2.5 px-4 truncate max-w-[220px]" :title="row.original_url">{{ row.original_url }}</td>
                <td class="py-2.5 px-4 text-[#6e6e73]">{{ row.domain }}</td>
                <td class="py-2.5 px-4">
                  <span class="font-medium">{{ row.dr ?? "—" }}</span>
                  <span v-if="sourceBadge(row)" :class="sourceBadge(row)!.class" :title="sourceBadge(row)!.title"
                    class="ml-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium">
                    {{ sourceBadge(row)!.label }}
                  </span>
                  <div v-if="row.checked_at && row.dr !== null" class="text-xs text-[#86868b]">
                    checked {{ checkedAgo(row.checked_at) }}
                  </div>
                </td>
                <td class="py-2.5 px-4">
                  <span v-if="retryInfo(row)" class="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800"
                    :title="row.error_message ?? undefined">
                    retrying <small>· attempt {{ retryInfo(row)!.attempt }} of {{ retryInfo(row)!.of }}</small>
                  </span>
                  <span v-else :class="statusBadgeClass(row.status)">{{ row.status }} <small v-if="row.status === 'error'">
                      ({{ row.error_message }})
                    </small>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { UrlRow } from "~/composables/useBatchRealtime";

const props = withDefaults(defineProps<{ batchId: string; showTitle?: boolean }>(), { showTitle: true });
const emit = defineEmits<{ completed: [] }>();

const { batch, urls, loading, error, progressPct } = useBatchRealtime(props.batchId);

watch(
  () => batch.value?.status,
  (status, prev) => {
    if (status === "completed" && prev !== "completed") emit("completed");
  },
);

const sortedUrls = computed(() =>
  [...urls.value].sort((a, b) => a.original_url.localeCompare(b.original_url)),
);

const statusLabel = computed(() => {
  switch (batch.value?.status) {
    case "pending":
      return "Queued…";
    case "processing":
      return "Processing…";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "";
  }
});

function statusBadgeClass(status: string) {
  const base = "inline-block rounded-full px-2.5 py-0.5 text-xs font-medium";
  switch (status) {
    case "done":
      return `${base} bg-green-100 text-green-700`;
    case "error":
      return `${base} bg-red-100 text-red-700`;
    case "processing":
      return `${base} bg-accent-light text-accent`;
    default:
      return `${base} bg-black/5 text-[#6e6e73]`;
  }
}

function sourceBadge(row: UrlRow) {
  switch (row.source) {
    case "live":
      return { label: "live", class: "bg-accent-light text-accent", title: "Fetched from Ahrefs just now" };
    case "cache":
      return { label: "cached", class: "bg-black/5 text-[#6e6e73]", title: "From the directory (checked in the last 30 days)" };
    case "stale":
      return { label: "stale", class: "bg-amber-100 text-amber-800", title: "Ahrefs was unavailable; showing the last known DR" };
    default:
      return null;
  }
}

function checkedAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function download() {
  window.location.href = `/api/download/${props.batchId}`;
}
</script>
