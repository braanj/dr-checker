<template>
  <nav v-if="total > 0" class="flex flex-wrap items-center justify-between gap-2 text-[#555]" aria-label="Pagination">
    <p class="tabular-nums">{{ from }}–{{ to }} of {{ total }}</p>

    <div class="flex items-center gap-px">
      <button type="button" :class="[btn, idle]" :disabled="page <= 1" aria-label="Previous page" @click="$emit('page', page - 1)">Prev</button>
      <template v-for="(p, i) in pages" :key="`${p}-${i}`">
        <span v-if="p === '…'" class="px-1" aria-hidden="true">…</span>
        <button
          v-else
          type="button"
          :class="[btn, 'tabular-nums', p === page ? 'border-accent bg-accent text-white' : idle]"
          :aria-current="p === page ? 'page' : undefined"
          :aria-label="`Page ${p}`"
          @click="$emit('page', p)"
        >{{ p }}</button>
      </template>
      <button type="button" :class="[btn, idle]" :disabled="page >= totalPages" aria-label="Next page" @click="$emit('page', page + 1)">Next</button>
    </div>

    <label class="flex items-center gap-1.5">
      Rows per page
      <select
        :value="pageSize"
        class="input-sm py-px"
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
  "min-w-6 rounded-sm border px-1.5 py-px disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const idle = "border-[#ccc] bg-white text-[#1d1d1f] hover:bg-[#f0f0f0] disabled:hover:bg-white";
const pages = computed(() => pageRange(props.page, props.totalPages));
const from = computed(() => (props.page - 1) * props.pageSize + 1);
const to = computed(() => Math.min(props.total, props.page * props.pageSize));
</script>
