<template>
  <div class="mx-auto max-w-3xl px-4 py-16">
    <NuxtLink to="/" class="text-sm text-[#6e6e73] transition-colors hover:text-accent">← New check</NuxtLink>
    <CheckResults :batch-id="batchId" />
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const batchId = route.params.batchId as string;
</script>
