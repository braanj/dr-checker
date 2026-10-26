<template>
  <nav v-if="total > 0" class="flex flex-wrap items-center justify-between gap-3 text-sm text-[#6e6e73]" aria-label="Pagination">
    <p class="tabular-nums">{{ from }}–{{ to }} of {{ total }}</p>

    <div class="flex items-center gap-1">
      <button type="button" :class="btn" :disabled="page <= 1" aria-label="Previous page" @click="$emit('page', page - 1)">Prev</button>
      <template v-for="(p, i) in pages" :key="`${p}-${i}`">
        <span v-if="p === '…'" class="px-1" aria-hidden="true">…</span>
        <button
          v-else
          type="button"
          :class="[btn, 'tabular-nums', p === page ? 'bg-accent text-white hover:bg-accent' : '']"
          :aria-current="p === page ? 'page' : undefined"
          :aria-label="`Page ${p}`"
          @click="$emit('page', p)"
        >{{ p }}</button>
      </template>
      <button type="button" :class="btn" :disabled="page >= totalPages" aria-label="Next page" @click="$emit('page', page + 1)">Next</button>
    </div>

    <label class="flex items-center gap-2">
      Rows per page
      <select
        :value="pageSize"
        class="rounded-lg border border-black/10 bg-white px-2 py-1 text-[#1d1d1f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        @change="$emit('pageSize', Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="n in [20, 50, 100]" :key="n" :value="n">{{ n }}</option>
      </select>
    </label>
  </nav>
</template>

<script setup lang="ts">
import { pageRange } from "~/utils/domainsTable";

const props = defineProps<{ page: number; pageSize: number; total: number; totalPages: number }>();
defineEmits<{ page: [number]; pageSize: [number] }>();

const btn =
  "min-w-8 rounded-lg px-2 py-1 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const pages = computed(() => pageRange(props.page, props.totalPages));
const from = computed(() => (props.page - 1) * props.pageSize + 1);
const to = computed(() => Math.min(props.total, props.page * props.pageSize));
</script>
