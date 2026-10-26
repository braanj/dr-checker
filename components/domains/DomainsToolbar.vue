<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <input
        v-model="domain"
        type="search"
        placeholder="Search domains"
        aria-label="Search domains"
        :class="[field, 'min-w-0 flex-1 basis-48']"
        @input="schedule"
      />
      <div class="flex items-center gap-1.5">
        <input v-model="drMin" type="number" min="0" max="100" inputmode="numeric" placeholder="DR min" aria-label="Minimum DR" :class="[field, 'w-24']" @input="schedule" />
        <span class="text-[#86868b]" aria-hidden="true">–</span>
        <input v-model="drMax" type="number" min="0" max="100" inputmode="numeric" placeholder="DR max" aria-label="Maximum DR" :class="[field, 'w-24']" @input="schedule" />
      </div>
      <input v-model="tld" type="text" placeholder=".tld" aria-label="TLD" :class="[field, 'w-24']" @input="schedule" />
    </div>

    <details class="text-sm text-[#6e6e73]" :open="!!(state.checkedFrom || state.checkedTo) || undefined">
      <summary class="w-fit cursor-pointer rounded-md hover:text-[#1d1d1f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">More filters</summary>
      <div class="mt-2 flex flex-wrap gap-3">
        <label class="flex items-center gap-2">Checked from
          <input type="date" :value="state.checkedFrom" :class="field" @change="emit('update', { checkedFrom: ($event.target as HTMLInputElement).value })" />
        </label>
        <label class="flex items-center gap-2">to
          <input type="date" :value="state.checkedTo" :class="field" @change="emit('update', { checkedTo: ($event.target as HTMLInputElement).value })" />
        </label>
      </div>
    </details>

    <ul v-if="chips.length" class="flex flex-wrap items-center gap-2" aria-label="Active filters">
      <li v-for="c in chips" :key="c.key">
        <button type="button" :class="chip" :aria-label="`Remove filter ${c.label}`" @click="emit('update', c.clear)">
          {{ c.label }} <span aria-hidden="true">✕</span>
        </button>
      </li>
      <li>
        <button type="button" class="rounded-md px-1 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" @click="emit('clear')">Clear all</button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { DomainsState } from "~/utils/domainsTable";

const props = defineProps<{ state: DomainsState }>();
const emit = defineEmits<{ update: [patch: Partial<DomainsState>]; clear: [] }>();

const field =
  "rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-[#1d1d1f] placeholder:text-[#86868b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const chip =
  "inline-flex items-center gap-1.5 rounded-full bg-accent-light px-3 py-1 text-sm text-accent hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const domain = ref(props.state.domain);
const tld = ref(props.state.tld);
const drMin = ref(props.state.drMin);
const drMax = ref(props.state.drMax);

// Keep inputs in step with the URL (back/forward, chip removal).
watch(() => props.state, (s) => {
  domain.value = s.domain;
  tld.value = s.tld;
  drMin.value = s.drMin;
  drMax.value = s.drMax;
});

let timer: ReturnType<typeof setTimeout> | undefined;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    emit("update", {
      domain: String(domain.value ?? "").trim(),
      tld: String(tld.value ?? "").trim().replace(/^\.+/, "").toLowerCase(),
      drMin: String(drMin.value ?? ""),
      drMax: String(drMax.value ?? ""),
    });
  }, 350);
}
onBeforeUnmount(() => clearTimeout(timer));

const chips = computed(() => {
  const s = props.state;
  const out: { key: string; label: string; clear: Partial<DomainsState> }[] = [];
  if (s.domain) out.push({ key: "domain", label: `domain: ${s.domain}`, clear: { domain: "" } });
  if (s.drMin || s.drMax) {
    out.push({ key: "dr", label: `DR ${s.drMin || "0"}–${s.drMax || "100"}`, clear: { drMin: "", drMax: "" } });
  }
  if (s.tld) out.push({ key: "tld", label: `.${s.tld}`, clear: { tld: "" } });
  if (s.checkedFrom) out.push({ key: "from", label: `from ${s.checkedFrom}`, clear: { checkedFrom: "" } });
  if (s.checkedTo) out.push({ key: "to", label: `to ${s.checkedTo}`, clear: { checkedTo: "" } });
  return out;
});
</script>
