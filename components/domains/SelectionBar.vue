<template>
  <div
    class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-[#ccc] bg-[#f3f3f3] px-2 py-1.5 shadow-md"
    role="region"
    aria-label="Selection"
  >
    <p class="font-semibold tabular-nums text-[#1d1d1f]">{{ count }} selected</p>
    <div class="ml-auto flex items-center gap-1.5">
      <button type="button" class="btn-sm" @click="emit('clear')">Clear selection</button>
      <button
        type="button"
        class="btn-sm btn-primary"
        :disabled="exporting"
        @click="emit('export')"
      >{{ exporting ? "Exporting…" : "Export selected" }}</button>
    </div>
    <p v-if="capped" class="basis-full text-[11px] text-[#555]" role="status">Selection is limited to 1,000 domains.</p>
    <p v-if="message" class="basis-full text-[11px] text-[#b3261e]" role="alert">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ count: number; exporting: boolean; capped: boolean; message: string }>();
const emit = defineEmits<{ clear: []; export: [] }>();
</script>
