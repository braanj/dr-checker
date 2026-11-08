<template>
  <span class="block h-1.5 w-10 overflow-hidden bg-black/10" aria-hidden="true" :title="`DR ${value} of 100`">
    <span class="block h-full" :class="color" :style="{ width: `${width}%` }" />
  </span>
</template>

<script setup lang="ts">
import { drBand } from "~/utils/domainsTable";

const props = defineProps<{ dr: number | string }>();
const value = computed(() => Number(props.dr));
const width = computed(() => Math.min(100, Math.max(0, value.value)));
const color = computed(
  () => ({ low: "bg-black/20", mid: "bg-amber-400", high: "bg-accent", top: "bg-emerald-500" })[drBand(value.value)],
);
</script>
