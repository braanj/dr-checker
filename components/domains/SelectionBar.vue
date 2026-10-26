<template>
  <div
    class="sticky bottom-4 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-black/5 bg-white p-3 shadow-lg"
    role="region"
    aria-label="Selection"
  >
    <p class="text-sm font-medium tabular-nums text-[#1d1d1f]">{{ count }} selected</p>
    <div class="ml-auto flex items-center gap-2">
      <button type="button" :class="[btn, 'text-[#6e6e73] hover:text-[#1d1d1f]']" @click="emit('clear')">Clear selection</button>
      <button
        type="button"
        :class="[btn, 'bg-accent text-white hover:bg-accent-hover disabled:opacity-60']"
        :disabled="exporting"
        @click="emit('export')"
      >{{ exporting ? "Exporting…" : "Export selected" }}</button>
    </div>
    <p v-if="capped" class="basis-full text-xs text-[#6e6e73]" role="status">Selection is limited to 1,000 domains.</p>
    <p v-if="message" class="basis-full text-xs text-[#b3261e]" role="alert">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ count: number; exporting: boolean; capped: boolean; message: string }>();
const emit = defineEmits<{ clear: []; export: [] }>();

const btn =
  "rounded-full px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
</script>
