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
        <div v-else-if="data && data.total > 0 && data.domains.length === 0" class="p-10 text-center">
          <p class="text-[15px] text-[#1d1d1f]">This page is out of range.</p>
          <button type="button" class="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" @click="update({ page: 1 }, true)">Go to page 1</button>
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
        >
          <template #select-header>
            <input
              type="checkbox"
              aria-label="Select all domains on this page"
              class="h-4 w-4 cursor-pointer rounded accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              :checked="pageState === 'all'"
              :indeterminate="pageState === 'some'"
              @change="onTogglePage(($event.target as HTMLInputElement).checked)"
            />
          </template>
          <template #select-cell="{ row }">
            <input type="checkbox" :aria-label="`Select ${row.domain}`" class="h-4 w-4 cursor-pointer rounded accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" :checked="selection.has(row.domain)" @change="onToggle(row.domain)" />
          </template>
          <template #select-card="{ row }">
            <input type="checkbox" :aria-label="`Select ${row.domain}`" class="h-4 w-4 cursor-pointer rounded accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" :checked="selection.has(row.domain)" @change="onToggle(row.domain)" />
          </template>
        </DomainsTable>
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

      <DomainsSelectionBar
        v-if="selection.size > 0"
        :count="selection.size"
        :exporting="exporting"
        :capped="capped"
        :message="exportMessage"
        @clear="clearSelection"
        @export="exportSelected"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DomainsResponse, SortBy } from "~/server/utils/domainsQuery";
import { loadSelection, pageCheckState, saveSelection, setPage, toggleDomain } from "~/utils/domainSelection";
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

// Selection is client-only (sessionStorage), so SSR renders unchecked boxes.
const selection = ref<Set<string>>(new Set());
const capped = ref(false);
const exporting = ref(false);
const exportMessage = ref("");

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
onMounted(() => {
  selection.value = loadSelection(storage());
});
function commit(r: { sel: Set<string>; capped: boolean }) {
  selection.value = r.sel;
  capped.value = r.capped;
  exportMessage.value = "";
  saveSelection(storage(), r.sel);
}
const pageDomains = computed(() => data.value?.domains.map((d) => d.domain) ?? []);
const pageState = computed(() => pageCheckState(selection.value, pageDomains.value));
function onToggle(domain: string) {
  commit(toggleDomain(selection.value, domain));
}
function onTogglePage(on: boolean) {
  commit(setPage(selection.value, pageDomains.value, on));
}
function clearSelection() {
  commit({ sel: new Set(), capped: false });
}

async function exportSelected() {
  if (exporting.value || selection.value.size === 0) return;
  exporting.value = true;
  exportMessage.value = "";
  try {
    const res = await fetch("/api/domains/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domains: [...selection.value] }),
    });
    if (res.status === 429) {
      exportMessage.value = "Too many exports. Try again in a minute.";
      return;
    }
    if (!res.ok) {
      exportMessage.value = "Export failed. Please try again.";
      return;
    }
    const blob = await res.blob();
    const name = /filename="?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "dr-domains.csv";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    exportMessage.value = "Export failed. Please try again.";
  } finally {
    exporting.value = false;
  }
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
