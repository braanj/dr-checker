<template>
  <div class="mx-auto max-w-3xl px-4 py-16">
    <NuxtLink to="/" class="text-sm text-[#6e6e73] transition-colors hover:text-accent">← New upload</NuxtLink>

    <div v-if="loading" class="mt-6 text-[#86868b]">Loading batch…</div>
    <div v-else-if="error" class="mt-6 text-red-600">{{ error }}</div>

    <template v-else-if="batch">
      <h1 class="mt-4 text-3xl font-semibold tracking-tight text-[#1d1d1f]">{{ batch.filename }}</h1>

      <div class="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <div class="flex justify-between text-sm text-[#6e6e73] mb-2">
          <span>{{ statusLabel }}</span>
          <span>{{ batch.processed_urls }} / {{ batch.total_urls }}</span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-black/5">
          <div class="h-full rounded-full bg-accent transition-all duration-300" :style="{ width: progressPct + '%' }" />
        </div>
      </div>

      <button v-if="batch.processed_urls"
        class="mt-6 rounded-full bg-[#1d1d1f] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-black"
        @click="download">
        Download CSV
      </button>

      <div class="mt-8 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
        <table class="w-full text-sm border-collapse">
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
              <td class="py-2.5 px-4 font-medium">{{ row.dr ?? "—" }}</td>
              <td class="py-2.5 px-4">
                <span :class="statusBadgeClass(row.status)">{{ row.status }} <small v-if="row.status === 'error'">
                    ({{ row.error_message }})
                  </small>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
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

function download() {
  window.location.href = `/api/download/${batchId}`;
}
</script>
