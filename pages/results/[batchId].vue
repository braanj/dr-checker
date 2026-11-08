<template>
  <div class="px-3 py-2">
    <NuxtLink to="/" class="rounded-sm text-[#6e6e73] hover:text-[#1d1d1f] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">← New check</NuxtLink>
    <CheckResults :batch-id="batchId" />
  </div>
</template>

<script setup lang="ts">
useHead({ title: "Check results | DR Checker" });

const route = useRoute();
const batchId = route.params.batchId as string;
</script>
