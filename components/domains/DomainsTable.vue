<template>
  <div>
    <!-- md+: table -->
    <table class="hidden w-full text-left text-sm md:table">
      <thead class="sticky top-0 z-10 bg-white text-xs text-[#6e6e73]">
        <tr class="border-b border-black/5">
          <th scope="col" class="w-10 py-3 pl-4"><slot name="select-header" /></th>
          <th scope="col" :aria-sort="ariaSort('domain')" class="px-3 py-3 font-medium">
            <button type="button" :class="sortBtn" @click="emit('sort', 'domain')">Domain <span aria-hidden="true">{{ arrow("domain") }}</span></button>
          </th>
          <th scope="col" :aria-sort="ariaSort('dr')" class="px-3 py-3 text-right font-medium">
            <button type="button" :class="[sortBtn, 'ml-auto']" @click="emit('sort', 'dr')">DR <span aria-hidden="true">{{ arrow("dr") }}</span></button>
          </th>
          <th scope="col" :aria-sort="ariaSort('dr_change')" class="px-3 py-3 text-right font-medium">
            <button type="button" :class="[sortBtn, 'ml-auto']" @click="emit('sort', 'dr_change')">Δ <span aria-hidden="true">{{ arrow("dr_change") }}</span></button>
          </th>
          <th scope="col" class="hidden px-3 py-3 font-medium lg:table-cell">Trend</th>
          <th scope="col" :aria-sort="ariaSort('checked_at')" class="py-3 pl-3 pr-4 text-right font-medium">
            <button type="button" :class="[sortBtn, 'ml-auto']" @click="emit('sort', 'checked_at')">Checked <span aria-hidden="true">{{ arrow("checked_at") }}</span></button>
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-if="loading">
          <tr v-for="n in 8" :key="`sk-${n}`" class="border-b border-black/5 last:border-0" aria-hidden="true">
            <td v-for="c in 6" :key="c" class="px-3 py-4" :class="c === 5 ? 'hidden lg:table-cell' : ''"><div class="h-4 animate-pulse rounded bg-black/5" /></td>
          </tr>
        </template>
        <tr
          v-for="row in rows"
          v-else
          :key="row.domain"
          class="cursor-pointer border-b border-black/5 last:border-0 hover:bg-black/[0.03]"
          @click="go(row.domain)"
        >
          <td class="w-10 py-3 pl-4" @click.stop><slot name="select-cell" :row="row" /></td>
          <td class="max-w-0 px-3 py-3">
            <div class="flex items-center gap-3">
              <img v-if="row.favicon_url" :src="row.favicon_url" width="20" height="20" loading="lazy" alt="" class="h-5 w-5 shrink-0 rounded" />
              <span v-else class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-black/5 text-[11px] font-medium uppercase text-[#6e6e73]" aria-hidden="true">{{ row.domain.charAt(0) }}</span>
              <div class="min-w-0">
                <NuxtLink :to="domainPath(row.domain)" class="block truncate rounded font-medium text-[#1d1d1f] hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" @click.stop>{{ row.domain }}</NuxtLink>
                <p v-if="row.title" class="truncate text-xs text-[#6e6e73]" :title="row.title">{{ row.title }}</p>
              </div>
            </div>
          </td>
          <td class="px-3 py-3 text-right tabular-nums">
            <template v-if="row.dr !== null">
              <span class="font-medium">{{ formatDr(Number(row.dr)) }}</span>
              <DomainsDrBar :dr="row.dr" class="ml-auto mt-1" />
            </template>
            <span v-else class="text-[#86868b]">—</span>
          </td>
          <td class="px-3 py-3 text-right tabular-nums">
            <DomainsDrDelta :change="row.dr_change" />
          </td>
          <td class="hidden px-3 py-3 lg:table-cell"><DomainsTrendSpark :values="row.trend" /></td>
          <td class="whitespace-nowrap py-3 pl-3 pr-4 text-right tabular-nums text-[#6e6e73]">
            <ClientOnly>
              <template #fallback>{{ isoDate(row.checked_at) }}</template>
              <span :title="isoDate(row.checked_at)">{{ checkedAgo(row.checked_at) }}</span>
            </ClientOnly>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- < md: cards -->
    <ul class="divide-y divide-black/5 md:hidden">
      <template v-if="loading">
        <li v-for="n in 8" :key="`sk-${n}`" class="p-4" aria-hidden="true"><div class="h-10 animate-pulse rounded bg-black/5" /></li>
      </template>
      <li v-for="row in rows" v-else :key="row.domain" class="flex items-center gap-3 p-4">
        <div class="empty:hidden"><slot name="select-card" :row="row" /></div>
        <img v-if="row.favicon_url" :src="row.favicon_url" width="20" height="20" loading="lazy" alt="" class="h-5 w-5 shrink-0 rounded" />
        <span v-else class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-black/5 text-[11px] font-medium uppercase text-[#6e6e73]" aria-hidden="true">{{ row.domain.charAt(0) }}</span>
        <div class="min-w-0 flex-1">
          <NuxtLink :to="domainPath(row.domain)" class="block truncate rounded font-medium text-[#1d1d1f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{{ row.domain }}</NuxtLink>
          <p v-if="row.title" class="truncate text-xs text-[#6e6e73]" :title="row.title">{{ row.title }}</p>
          <p class="mt-0.5 text-xs text-[#86868b]">
            <ClientOnly>
              <template #fallback>{{ isoDate(row.checked_at) }}</template>
              {{ checkedAgo(row.checked_at) }}
            </ClientOnly>
          </p>
        </div>
        <div class="shrink-0 text-right tabular-nums">
          <p v-if="row.dr !== null" class="font-medium">DR {{ formatDr(Number(row.dr)) }}</p>
          <p v-else class="text-[#86868b]">—</p>
          <DomainsDrDelta :change="row.dr_change" class="text-xs" />
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
  "flex items-center gap-1 rounded-md px-1 py-0.5 hover:text-[#1d1d1f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

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
