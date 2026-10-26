<template>
  <span class="block h-1 w-14 overflow-hidden rounded-full bg-black/5" aria-hidden="true">
    <span class="block h-full rounded-full" :class="color" :style="{ width: `${width}%` }" />
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
