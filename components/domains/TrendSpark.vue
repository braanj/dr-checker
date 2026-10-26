<template>
  <svg v-if="path" width="80" height="24" viewBox="0 0 80 24" fill="none" role="img" :aria-label="`DR trend over ${values.length} checks`">
    <path :d="path" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-accent" />
  </svg>
</template>

<script setup lang="ts">
const props = defineProps<{ values: number[] }>();
const path = computed(() => {
  const v = props.values.map(Number);
  return v.length < 2 ? "" : sparklinePath(v, 80, 24);
});
</script>
