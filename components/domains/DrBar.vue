<template>
  <span class="block h-1.5 w-10 overflow-hidden bg-black/10" aria-hidden="true" :title="`DR ${value} of 100`">
    <span class="block h-full" :style="{ width: `${width}%`, backgroundColor: DR_BAND_COLORS[drBand(value)] }" />
  </span>
</template>

<script setup lang="ts">
import { DR_BAND_COLORS, drBand } from "~/utils/domainsTable";

const props = defineProps<{ dr: number | string }>();
const value = computed(() => Number(props.dr));
const width = computed(() => Math.min(100, Math.max(0, value.value)));
</script>
