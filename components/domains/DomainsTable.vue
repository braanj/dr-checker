<template>
  <div>
    <table class="data-table hidden md:table">
      <thead class="sticky top-0 z-10 [&_th]:shadow-[inset_0_-1px_0_#ccc]">
        <tr>
          <th scope="col" class="w-7 text-center"><slot name="select-header" /></th>
          <th scope="col" :aria-sort="ariaSort('domain')">
            <button type="button" :class="sortBtn" @click="emit('sort', 'domain')">Domain <span aria-hidden="true">{{ arrow("domain") }}</span></button>
          </th>
          <th scope="col" :aria-sort="ariaSort('dr')" class="w-24 text-right" :title="HINTS.dr">
            <button type="button" :class="[sortBtn, 'ml-auto']" @click="emit('sort', 'dr')">DR <span aria-hidden="true">{{ arrow("dr") }}</span></button>
          </th>
          <th scope="col" :aria-sort="ariaSort('dr_change')" class="w-14 text-right" :title="HINTS.change">
            <button type="button" :class="[sortBtn, 'ml-auto']" @click="emit('sort', 'dr_change')">Δ <span aria-hidden="true">{{ arrow("dr_change") }}</span></button>
          </th>
          <th scope="col">Title</th>
          <th scope="col" class="hidden w-20 lg:table-cell" :title="HINTS.trend">Trend</th>
          <th scope="col" :aria-sort="ariaSort('checked_at')" class="w-24 text-right" :title="HINTS.checked">
            <button type="button" :class="[sortBtn, 'ml-auto']" @click="emit('sort', 'checked_at')">Checked <span aria-hidden="true">{{ arrow("checked_at") }}</span></button>
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-if="loading">
          <tr v-for="n in 12" :key="`sk-${n}`" aria-hidden="true">
            <td v-for="c in 7" :key="c" :class="c === 6 ? 'hidden lg:table-cell' : ''"><div class="my-0.5 h-3 animate-pulse bg-black/5" /></td>
          </tr>
        </template>
        <tr v-for="row in rows" v-else :key="row.domain" class="cursor-pointer" @click="go(row.domain)">
          <td class="text-center" @click.stop><slot name="select-cell" :row="row" /></td>
          <td class="max-w-0">
            <div class="flex items-center gap-1.5">
              <img v-if="row.favicon_url" :src="row.favicon_url" width="14" height="14" loading="lazy" alt="" class="h-3.5 w-3.5 shrink-0" />
              <span v-else class="flex h-3.5 w-3.5 shrink-0 items-center justify-center bg-black/10 text-[9px] font-medium uppercase text-[#333]" aria-hidden="true">{{ row.domain.charAt(0) }}</span>
              <NuxtLink :to="domainPath(row.domain)" class="truncate rounded-sm font-medium text-[#1d1d1f] hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" @click.stop>{{ row.domain }}</NuxtLink>
            </div>
          </td>
          <td class="text-right tabular-nums">
            <div v-if="row.dr !== null" class="flex items-center justify-end gap-1.5">
              <DomainsDrBar :dr="row.dr" />
              <span class="w-6 font-medium">{{ formatDr(Number(row.dr)) }}</span>
            </div>
            <span v-else class="text-[#6e6e73]">—</span>
          </td>
          <td class="text-right"><DomainsDrDelta :change="row.dr_change" /></td>
          <td class="max-w-0 truncate text-[#555]" :title="row.title ?? undefined">{{ row.title }}</td>
          <td class="hidden py-0 lg:table-cell"><DomainsTrendSpark :values="row.trend" class="block" /></td>
          <td class="whitespace-nowrap text-right tabular-nums text-[#555]">
            <ClientOnly>
              <template #fallback>{{ isoDate(row.checked_at) }}</template>
              <span :title="isoDate(row.checked_at)">{{ checkedAgo(row.checked_at) }}</span>
            </ClientOnly>
          </td>
        </tr>
      </tbody>
    </table>

    <ul class="md:hidden">
      <template v-if="loading">
        <li v-for="n in 12" :key="`sk-${n}`" class="border-b border-[#e3e3e3] px-2 py-1.5" aria-hidden="true"><div class="h-6 animate-pulse bg-black/5" /></li>
      </template>
      <li v-for="row in rows" v-else :key="row.domain" class="flex items-center gap-2 border-b border-[#e3e3e3] px-2 py-1 last:border-0 even:bg-[#f8f8f8]">
        <div class="empty:hidden"><slot name="select-card" :row="row" /></div>
        <img v-if="row.favicon_url" :src="row.favicon_url" width="14" height="14" loading="lazy" alt="" class="h-3.5 w-3.5 shrink-0" />
        <span v-else class="flex h-3.5 w-3.5 shrink-0 items-center justify-center bg-black/10 text-[9px] font-medium uppercase text-[#333]" aria-hidden="true">{{ row.domain.charAt(0) }}</span>
        <div class="min-w-0 flex-1">
          <NuxtLink :to="domainPath(row.domain)" class="block truncate rounded-sm font-medium text-[#1d1d1f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{{ row.domain }}</NuxtLink>
          <p class="truncate text-[11px] text-[#6e6e73]">
            <ClientOnly>
              <template #fallback>{{ isoDate(row.checked_at) }}</template>
              <span :title="isoDate(row.checked_at)">{{ checkedAgo(row.checked_at) }}</span>
            </ClientOnly>
            <template v-if="row.title"> · <span :title="row.title">{{ row.title }}</span></template>
          </p>
        </div>
        <div class="shrink-0 text-right tabular-nums">
          <p v-if="row.dr !== null" class="font-medium" :title="HINTS.dr">DR {{ formatDr(Number(row.dr)) }}</p>
          <p v-else class="text-[#6e6e73]">—</p>
          <DomainsDrDelta :change="row.dr_change" class="text-[11px]" />
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { DomainListRow, SortBy } from "~/server/utils/domainsQuery";
import type { DomainsState } from "~/utils/domainsTable";

const props = defineProps<{
  rows: DomainListRow[];
  sortBy: DomainsState["sortBy"];
  sortDir: DomainsState["sortDir"];
  loading?: boolean;
}>();
const emit = defineEmits<{ sort: [col: SortBy] }>();

const sortBtn =
  "flex items-center gap-1 rounded-sm hover:text-black hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function ariaSort(col: SortBy) {
  if (props.sortBy !== col) return "none";
  return props.sortDir === "asc" ? "ascending" : "descending";
}
function arrow(col: SortBy) {
  if (props.sortBy !== col) return "";
  return props.sortDir === "asc" ? "↑" : "↓";
}
function go(domain: string) {
  return navigateTo(domainPath(domain));
}
</script>
