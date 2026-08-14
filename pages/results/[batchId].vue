<template>
  <div class="max-w-3xl mx-auto px-4 py-16">
    <NuxtLink to="/" class="text-sm text-slate-500 hover:underline">← New upload</NuxtLink>

    <div v-if="loading" class="mt-6 text-slate-500">Loading batch…</div>
    <div v-else-if="error" class="mt-6 text-red-600">{{ error }}</div>

    <template v-else-if="batch">
      <h1 class="mt-4 text-xl font-semibold text-slate-900">{{ batch.filename }}</h1>

      <div class="mt-4">
        <div class="flex justify-between text-sm text-slate-600 mb-1">
          <span>{{ statusLabel }}</span>
          <span>{{ batch.processed_urls }} / {{ batch.total_urls }}</span>
        </div>
        <div class="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
          <div class="h-full bg-slate-900 transition-all duration-300" :style="{ width: progressPct + '%' }" />
        </div>
      </div>

      <button v-if="!['pending', 'processing', 'failed'].includes(batch.status)"
        class="mt-6 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white" @click="download">
        Download CSV
      </button>

      <table class="mt-8 w-full text-sm border-collapse">
        <thead>
          <tr class="text-left text-slate-500 border-b border-slate-200">
            <th class="py-2 pr-4">URL</th>
            <th class="py-2 pr-4">Domain</th>
            <th class="py-2 pr-4">DR</th>
            <th class="py-2 pr-4">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in sortedUrls" :key="row.id" class="border-b border-slate-100">
            <td class="py-2 pr-4 truncate max-w-[220px]" :title="row.original_url">{{ row.original_url }}</td>
            <td class="py-2 pr-4 text-slate-500">{{ row.domain }}</td>
            <td class="py-2 pr-4 font-medium">{{ row.dr ?? "—" }}</td>
            <td class="py-2 pr-4">
              <span :class="statusBadgeClass(row.status)">{{ row.status }} <small v-if="row.status === 'error'">
                  ({{ row.error_message }})
                </small>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const batchId = route.params.batchId as string;

const { batch, urls, loading, error, progressPct } = useBatchRealtime(batchId);

const sortedUrls = computed(() =>
  [...urls.value].sort((a, b) => a.original_url.localeCompare(b.original_url))
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
  const base = "inline-block rounded-full px-2 py-0.5 text-xs font-medium";
  switch (status) {
    case "done":
      return `${base} bg-green-100 text-green-700`;
    case "error":
      return `${base} bg-red-100 text-red-700`;
    case "processing":
      return `${base} bg-amber-100 text-amber-700`;
    default:
      return `${base} bg-slate-100 text-slate-500`;
  }
}

function download() {
  window.location.href = `/api/download/${batchId}`;
}
</script>
