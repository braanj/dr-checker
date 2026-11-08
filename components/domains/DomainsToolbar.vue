<template>
  <div class="space-y-2">
    <label class="block">
      <span class="panel-label">Search domains</span>
      <input v-model="domain" type="search" placeholder="example.com" class="input-sm mt-0.5 w-full" @input="schedule" />
    </label>
    <label class="block">
      <span class="panel-label">TLD</span>
      <input v-model="tld" type="text" placeholder=".com" class="input-sm mt-0.5 w-full" @input="schedule" />
    </label>
    <div>
      <p class="panel-label" aria-hidden="true">DR min / max</p>
      <div class="mt-0.5 flex items-center gap-1">
        <input v-model="drMin" type="number" min="0" max="100" inputmode="numeric" placeholder="0" aria-label="Minimum DR" class="input-sm w-full min-w-0" @input="schedule" />
        <span class="text-[#555]" aria-hidden="true">–</span>
        <input v-model="drMax" type="number" min="0" max="100" inputmode="numeric" placeholder="100" aria-label="Maximum DR" class="input-sm w-full min-w-0" @input="schedule" />
      </div>
    </div>
    <label class="block">
      <span class="panel-label">Checked from</span>
      <input type="date" :value="state.checkedFrom" class="input-sm mt-0.5 w-full" @change="emit('update', { checkedFrom: ($event.target as HTMLInputElement).value })" />
    </label>
    <label class="block">
      <span class="panel-label">Checked to</span>
      <input type="date" :value="state.checkedTo" class="input-sm mt-0.5 w-full" @change="emit('update', { checkedTo: ($event.target as HTMLInputElement).value })" />
    </label>

    <ul v-if="chips.length" class="flex flex-wrap items-center gap-1 border-t border-[#ccc] pt-2" aria-label="Active filters">
      <li v-for="c in chips" :key="c.key">
        <button type="button" class="inline-flex items-center gap-1 rounded-sm border border-[#bbb] bg-white px-1.5 py-px text-[11px] text-[#1d1d1f] hover:bg-[#f0f0f0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" :aria-label="`Remove filter ${c.label}`" @click="emit('update', c.clear)">
          {{ c.label }} <span aria-hidden="true">✕</span>
        </button>
      </li>
      <li>
        <button type="button" class="rounded-sm px-1 text-[11px] text-[#1d1d1f] underline hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" @click="emit('clear')">Clear all</button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { DomainsState } from "~/utils/domainsTable";

const props = defineProps<{ state: DomainsState }>();
const emit = defineEmits<{ update: [patch: Partial<DomainsState>]; clear: [] }>();

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
