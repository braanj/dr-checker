<template>
  <div class="px-4 pb-24 pt-10">
    <div class="mx-auto max-w-5xl space-y-5">
      <header class="flex items-baseline justify-between gap-3">
        <h1 class="text-3xl font-semibold tracking-tight text-[#1d1d1f]">Domains</h1>
        <p v-if="data" class="text-sm tabular-nums text-[#6e6e73]">{{ data.total }} {{ data.total === 1 ? "domain" : "domains" }}</p>
      </header>

      <DomainsToolbar :state="state" @update="update" @clear="clearFilters" />

      <div class="rounded-2xl border border-black/5 bg-white">
        <div v-if="error && !data" class="p-10 text-center">
          <p class="text-[15px] text-[#1d1d1f]">Couldn't load domains.</p>
          <button type="button" class="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" @click="() => refresh()">Retry</button>
        </div>
        <div v-else-if="data && data.domains.length === 0" class="p-10 text-center">
          <template v-if="hasFilters">
            <p class="text-[15px] text-[#1d1d1f]">No domains match these filters.</p>
            <button type="button" class="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" @click="clearFilters">Clear filters</button>
          </template>
          <p v-else class="text-[15px] text-[#1d1d1f]">No domains checked yet.</p>
        </div>
        <DomainsTable
          v-else
          :rows="data?.domains ?? []"
          :loading="!data"
          :sort-by="state.sortBy"
          :sort-dir="state.sortDir"
          :class="{ 'opacity-50': pending && data }"
          @sort="onSort"
        />
      </div>

      <DomainsPager
        v-if="data && data.total > 0"
        :page="data.page"
        :page-size="data.pageSize"
        :total="data.total"
        :total-pages="data.totalPages"
        @page="(p) => update({ page: p }, true)"
        @page-size="(n) => update({ pageSize: n as DomainsState['pageSize'] })"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DomainsResponse, SortBy } from "~/server/utils/domainsQuery";
import { DEFAULT_STATE, nextSort, parseDomainsRoute, toRouteQuery, type DomainsState } from "~/utils/domainsTable";

const route = useRoute();
const router = useRouter();

if (import.meta.server) {
  useResponseHeader("Cache-Control").value = "public, s-maxage=60, stale-while-revalidate=300";
}

useHead({
  title: "Domain directory | DR Checker",
  meta: [
    {
      name: "description",
      content: "Every domain checked with DR Checker: latest Ahrefs Domain Rating, change since the previous check and trend.",
    },
  ],
});

// Always parsed from the URL, so a hand-edited bad query shows the defaults.
const state = computed(() => parseDomainsRoute(route.query));
const { data, pending, error, refresh } = await useFetch<DomainsResponse>("/api/domains", {
  query: computed(() => toRouteQuery(state.value)),
});

const hasFilters = computed(() => {
  const s = state.value;
  return !!(s.domain || s.tld || s.drMin || s.drMax || s.checkedFrom || s.checkedTo);
});

// Any change resets to page 1 unless it is a page change itself.
function update(patch: Partial<DomainsState>, keepPage = false) {
  const next = { ...state.value, ...patch, page: patch.page ?? 1 };
  if (!keepPage && patch.page === undefined) next.page = 1;
  return router.replace({ query: toRouteQuery(next) });
}

function onSort(col: SortBy) {
  return update(nextSort(state.value, col));
}

function clearFilters() {
  return update({
    domain: DEFAULT_STATE.domain,
    tld: DEFAULT_STATE.tld,
    drMin: DEFAULT_STATE.drMin,
    drMax: DEFAULT_STATE.drMax,
    checkedFrom: DEFAULT_STATE.checkedFrom,
    checkedTo: DEFAULT_STATE.checkedTo,
  });
}
</script>
