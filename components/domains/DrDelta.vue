<template>
  <span class="inline-flex items-center justify-end gap-0.5 tabular-nums" :style="{ color: DELTA_COLORS[d.dir] }" :title="d.label">
    <svg v-if="d.dir === 'up'" class="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 10V2M2.5 5.5 6 2l3.5 3.5" /></svg>
    <svg v-else-if="d.dir === 'down'" class="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v8M2.5 6.5 6 10l3.5-3.5" /></svg>
    <span aria-hidden="true">{{ d.text }}</span>
    <span class="sr-only">{{ d.label }}</span>
  </span>
</template>

<script setup lang="ts">
import { DELTA_COLORS, formatDelta } from "~/utils/domainView";

const props = defineProps<{ change: number | string | null }>();
const d = computed(() => formatDelta(props.change === null ? null : Number(props.change)));
</script>
