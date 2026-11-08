<template>
  <div id="check-results" role="region" tabindex="-1" aria-label="Check results" class="focus:outline-none">
    <div v-if="loading" class="mt-2 text-[#6e6e73]">Loading results…</div>
    <div v-else-if="error" class="mt-2 text-red-600">{{ error }}</div>

    <template v-else-if="batch">
      <h1 v-if="showTitle" class="mt-1 [overflow-wrap:anywhere] text-[15px] font-semibold text-[#1d1d1f]">{{ batch.filename }}</h1>

      <div class="mt-2 rounded-sm border border-[#ccc] bg-[#f3f3f3] px-2 py-1.5">
        <div class="flex flex-wrap items-center gap-x-3 text-[#555]">
          <span role="status" class="font-semibold text-[#1d1d1f]">{{ statusLabel }}</span>
          <span class="tabular-nums">{{ batch.processed_urls }} / {{ batch.total_urls }}</span>
          <span v-if="batch.created_at">Started {{ new Date(batch.created_at).toLocaleString() }}</span>
        </div>
        <div class="mt-1 h-1 w-full overflow-hidden bg-[#ddd]">
          <div class="h-full transition-all duration-300"
            :class="batch.status === 'failed' ? 'bg-red-500' : 'bg-accent'" :style="{ width: progressPct + '%' }" />
        </div>
        <p v-if="batch.status === 'failed'" class="mt-1 text-[#b3261e]">
          None of these domains could be checked — see the errors below.
        </p>
      </div>

      <div v-if="batch.processed_urls" class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" class="btn-sm btn-primary" @click="download">Download CSV</button>
        <p class="text-[11px] text-[#6e6e73]">Results are kept for {{ RESULTS_KEPT_DAYS }} days — download the CSV to keep them.</p>
      </div>

      <div class="mt-2 overflow-x-auto">
        <table class="data-table" :class="{ 'sm:min-w-[560px]': showUrl }">
          <thead>
            <tr>
              <th v-if="showUrl" class="hidden sm:table-cell">URL</th>
              <th>Domain</th>
              <th class="text-right" :title="HINTS.dr">DR</th>
              <th>Status</th>
              <th>Checked</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in sortedUrls" :key="row.id">
              <td v-if="showUrl" class="hidden max-w-[220px] truncate sm:table-cell" :title="row.original_url">{{ row.original_url }}</td>
              <td>
                <NuxtLink :to="domainPath(row.domain)"
                  class="rounded-sm text-[#0058b0] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{{ row.domain }}</NuxtLink>
              </td>
              <td class="whitespace-nowrap text-right tabular-nums">
                <span v-if="sourceBadge(row)" :class="sourceBadge(row)!.class" :title="sourceBadge(row)!.title"
                  class="mr-1.5 inline-block rounded-sm px-1 text-[10px] font-medium">
                  {{ sourceBadge(row)!.label }}
                </span>
                <span class="font-medium">{{ row.dr ?? "—" }}</span>
              </td>
              <td>
                <span v-if="retryInfo(row)" class="inline-block rounded-sm bg-amber-100 px-1 text-[11px] font-medium text-amber-800"
                  :title="row.error_message ?? undefined">
                  retrying <small>· attempt {{ retryInfo(row)!.attempt }} of {{ retryInfo(row)!.of }}</small>
                </span>
                <span v-else :class="statusBadgeClass(row.status)" :title="STATUS_HINTS[row.status]">{{ row.status }} <small v-if="row.status === 'error'">
                    ({{ row.error_message }})
                  </small>
                </span>
              </td>
              <td class="whitespace-nowrap text-[#6e6e73]">
                <span v-if="row.checked_at && row.dr !== null" :title="isoDate(row.checked_at)">{{ checkedAgo(row.checked_at) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
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
    if (status === "completed" || status === "failed") trackCompleted(props.batchId, status);
    if (status === "completed" && prev !== "completed") emit("completed");
  },
);

const sortedUrls = computed(() =>
  [...urls.value].sort((a, b) => a.original_url.localeCompare(b.original_url)),
);

// Typed bare domains repeat themselves in the URL column; only show it when it adds
// something, and never on phones, where it would push DR and Status off-screen.
const showUrl = computed(() => urls.value.some((u) => u.original_url !== u.domain));

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
  const base = "inline-block rounded-sm px-1 text-[11px] font-medium";
  switch (status) {
    case "done":
      return `${base} bg-green-100 text-green-700`;
    case "error":
      return `${base} bg-red-100 text-red-700`;
    case "processing":
      return `${base} bg-accent-light text-[#0058b0]`;
    default:
      return `${base} bg-black/5 text-[#555]`;
  }
}

function sourceBadge(row: UrlRow) {
  switch (row.source) {
    case "live":
      return { label: "live", class: "bg-accent-light text-[#0058b0]", title: "Fetched from Ahrefs just now" };
    case "cache":
      return { label: "cached", class: "bg-black/5 text-[#555]", title: "From the directory (checked in the last 30 days)" };
    case "stale":
      return { label: "stale", class: "bg-amber-100 text-amber-800", title: "No new DR from Ahrefs; showing the last known one" };
    default:
      return null;
  }
}

function download() {
  if (batch.value) track("results_csv_download", { rows: batch.value.total_urls });
  window.location.href = `/api/download/${props.batchId}`;
}
</script>
