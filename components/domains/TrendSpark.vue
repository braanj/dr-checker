<template>
  <svg v-if="path" width="64" height="16" viewBox="0 0 64 16" fill="none" role="img" :aria-label="`DR trend over ${values.length} checks`">
    <path :d="path" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" class="text-accent" />
  </svg>
</template>

<script setup lang="ts">
const props = defineProps<{ values: number[] }>();
const path = computed(() => {
  const v = props.values.map(Number);
  return v.length < 2 ? "" : sparklinePath(v, 64, 16);
});
</script>
