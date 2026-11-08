<template>
  <div class="flex min-h-screen flex-col md:h-screen">
    <header class="flex items-center gap-2 border-b border-[#ccc] px-3 py-1.5">
      <h1 class="text-[15px] font-semibold text-[#1d1d1f]">Domains</h1>
      <p v-if="data" class="tabular-nums text-[#6e6e73]">{{ data.total }} {{ data.total === 1 ? "domain" : "domains" }}</p>
      <button
        type="button"
        class="btn-sm ml-auto md:hidden"
        aria-controls="domain-filters"
        :aria-expanded="filtersOpen"
        @click="filtersOpen = !filtersOpen"
      >
        Filters<span v-if="activeFilters" class="tabular-nums"> ({{ activeFilters }})</span>
      </button>
    </header>

    <div class="flex-1 md:flex md:min-h-0">
      <aside
        id="domain-filters"
        aria-label="Filters"
        class="shrink-0 border-b border-[#ccc] bg-[#f3f3f3] p-2 md:block md:w-[150px] md:overflow-y-auto md:border-b-0 md:border-r"
        :class="filtersOpen ? 'block' : 'hidden'"
      >
        <DomainsToolbar :state="state" @update="update" @clear="clearFilters" />
      </aside>

      <div class="min-w-0 flex-1 md:flex md:min-h-0 md:flex-col">
        <label class="flex items-center gap-1.5 px-3 py-2 text-[#555] md:hidden">
          Sort by
          <select :value="sortIndex" class="input-sm" @change="onSortSelect">
            <option v-for="(o, i) in SORT_OPTIONS" :key="o.label" :value="i">{{ o.label }}</option>
          </select>
        </label>

        <!-- relative: keeps the rows' absolutely positioned sr-only text inside the scroll box, so it can't stretch the page -->
        <div ref="tableScroller" class="relative bg-white md:min-h-0 md:flex-1 md:overflow-auto">
          <div v-if="error && !data" class="p-6 text-center">
            <p>Couldn't load domains.</p>
            <button type="button" class="btn-sm btn-primary mt-2" @click="() => refresh()">Retry</button>
          </div>
          <div v-else-if="data && data.total > 0 && data.domains.length === 0" class="p-6 text-center">
            <p>This page is out of range.</p>
            <button type="button" class="btn-sm btn-primary mt-2" @click="update({ page: 1 })">Go to page 1</button>
          </div>
          <div v-else-if="data && data.domains.length === 0" class="p-6 text-center">
            <template v-if="hasFilters">
              <p>No domains match these filters.</p>
              <div class="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                <button
                  v-if="checkableDomain"
                  type="button"
                  class="btn-sm btn-primary"
                  :disabled="checking"
                  @click="checkSearched"
                >
                  {{ checking ? "Checking…" : `Check ${checkableDomain} now` }}
                </button>
                <button type="button" class="btn-sm" :class="checkableDomain ? '' : 'btn-primary'" @click="clearFilters">
                  Clear filters
                </button>
              </div>
              <p v-if="checkError" role="alert" class="mt-2 text-red-600">{{ checkError }}</p>
            </template>
            <p v-else>No domains checked yet.</p>
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
                class="h-3.5 w-3.5 cursor-pointer align-middle accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                :checked="pageState === 'all'"
                :indeterminate="pageState === 'some'"
                @change="onTogglePage($event)"
              />
            </template>
            <template #select-cell="{ row }">
              <input type="checkbox" :aria-label="`Select ${row.domain}`" class="h-3.5 w-3.5 cursor-pointer align-middle accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" :checked="selection.has(row.domain)" @change="onToggle(row.domain, $event)" />
            </template>
            <template #select-card="{ row }">
              <label class="-m-1 flex cursor-pointer p-1">
                <input type="checkbox" :aria-label="`Select ${row.domain}`" class="h-3.5 w-3.5 cursor-pointer align-middle accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" :checked="selection.has(row.domain)" @change="onToggle(row.domain, $event)" />
              </label>
            </template>
          </DomainsTable>
        </div>

        <div v-if="(data && data.total > 0) || selection.size > 0" class="sticky bottom-0 z-20 space-y-1.5 border-t border-[#ccc] bg-white px-3 py-1.5">
          <DomainsPager
            v-if="data && data.total > 0"
            :page="data.page"
            :page-size="data.pageSize"
            :total="data.total"
            :total-pages="data.totalPages"
            @page="(p) => update({ page: p })"
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
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DomainsResponse, SortBy } from "~/server/utils/domainsQuery";
import { loadSelection, pageCheckState, saveSelection, setPage, toggleDomain } from "~/utils/domainSelection";
import { normalizeDomain } from "~/server/utils/domain";
import { DEFAULT_STATE, SORT_OPTIONS, nextSort, parseDomainsRoute, sortOptionIndex, toRouteQuery, type DomainsState } from "~/utils/domainsTable";

const route = useRoute();
const router = useRouter();

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

// The table scrolls in its own region on md+, so a new result set must start at its first row.
const tableScroller = ref<HTMLElement | null>(null);
watch(data, () => tableScroller.value?.scrollTo({ top: 0 }));

// Mirror the /domain/* rule: CDN-cache only on success; a failed render is
// 503 + no-store (no noindex, so a blip never de-indexes the page).
if (import.meta.server) {
  const cacheControl = useResponseHeader("Cache-Control");
  if (!error.value) {
    cacheControl.value = "public, s-maxage=60, stale-while-revalidate=300";
  } else {
    cacheControl.value = "no-store";
    setResponseStatus(useRequestEvent()!, 503);
  }
}

const activeFilters = computed(() => {
  const s = state.value;
  return [s.domain, s.tld, s.drMin, s.drMax, s.checkedFrom, s.checkedTo].filter(Boolean).length;
});
const hasFilters = computed(() => activeFilters.value > 0);
const filtersOpen = ref(false);

// Any change resets to page 1 unless it is a page change itself.
function update(patch: Partial<DomainsState>) {
  const next = { ...state.value, ...patch, page: patch.page ?? 1 };
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
// A rejected check at the cap must not stay visually checked.
function onToggle(domain: string, e: Event) {
  const r = toggleDomain(selection.value, domain);
  commit(r);
  if (r.capped && !r.sel.has(domain)) (e.target as HTMLInputElement).checked = false;
}
function onTogglePage(e: Event) {
  const input = e.target as HTMLInputElement;
  commit(setPage(selection.value, pageDomains.value, input.checked));
  const st = pageCheckState(selection.value, pageDomains.value);
  input.checked = st === "all";
  input.indeterminate = st === "some";
}
function clearSelection() {
  commit({ sel: new Set(), capped: false });
}

async function exportSelected() {
  if (exporting.value || selection.value.size === 0) return;
  exporting.value = true;
  exportMessage.value = "";
  const domains = [...selection.value];
  try {
    const res = await fetch("/api/domains/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domains }),
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
    track("directory_export", { count: domains.length });
  } catch {
    exportMessage.value = "Export failed. Please try again.";
  } finally {
    exporting.value = false;
  }
}

function onSort(col: SortBy) {
  return update(nextSort(state.value, col));
}

const sortIndex = computed(() => sortOptionIndex(state.value));
function onSortSelect(e: Event) {
  const o = SORT_OPTIONS[Number((e.target as HTMLSelectElement).value)];
  return update({ sortBy: o.sortBy, sortDir: o.sortDir });
}

// Only a bare domain search is a "not in the directory" signal; with other filters
// active, the domain may be listed and merely filtered out.
const checkableDomain = computed(() => {
  const { domain, tld, drMin, drMax, checkedFrom, checkedTo } = state.value;
  return tld || drMin || drMax || checkedFrom || checkedTo ? null : normalizeDomain(domain);
});
const checking = ref(false);
const checkError = ref("");

async function checkSearched() {
  const domain = checkableDomain.value;
  if (!domain) return;
  checking.value = true;
  checkError.value = "";
  try {
    const res = await submitCheck({ source: "typed", domains: domain });
    const inline = res.display === "inline";
    await navigateTo(recentHref({ batchId: res.batchId, inline }));
    if (inline) focusWhenPresent("check-results");
  } catch (e: any) {
    checkError.value = e?.data?.statusMessage ?? "Check failed. Please try again.";
  } finally {
    checking.value = false;
  }
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
