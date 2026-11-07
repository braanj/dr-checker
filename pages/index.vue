<template>
  <div>
    <header class="px-4 pb-8 pt-10">
      <div class="mx-auto max-w-2xl">
        <h1 class="text-3xl font-semibold tracking-tight text-[#1d1d1f]">Check Domain Rating</h1>
        <p class="mt-2 text-[15px] leading-relaxed text-[#6e6e73]">
          Type up to 100 domains or upload a CSV of up to 1,000.
          <NuxtLink class="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" to="/docs">How it works</NuxtLink>
        </p>
      </div>
    </header>
    <div class="mx-auto max-w-2xl px-4 pb-24">
      <form class="space-y-4" @submit.prevent="onSubmit">
        <textarea v-if="mode === 'typed'" ref="textareaEl" v-model="domainsText" rows="4"
          placeholder="example.com, another-site.org&#10;one per line or comma-separated (max 100)"
          aria-label="Domains to check"
          class="w-full rounded-2xl border border-black/10 bg-white p-4 text-[15px] text-[#1d1d1f] shadow-sm transition-colors focus:border-accent/50 focus:outline-none" />
        <p v-if="mode === 'typed' && domainsText.trim()" class="-mt-3 text-right text-xs"
          :class="typedCount > TYPED_MAX ? 'text-red-600' : 'text-[#6e6e73]'">
          {{ typedCount }} / {{ TYPED_MAX }}
        </p>

        <label v-else
          class="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-black/15 bg-white p-12 text-center shadow-sm transition-colors cursor-pointer hover:border-accent/50 hover:bg-accent-light/40 focus-within:ring-2 focus-within:ring-accent">
          <span class="text-[15px] font-medium text-[#1d1d1f]">
            {{ file ? file.name : "Click to choose a CSV file" }}
          </span>
          <span class="text-xs text-[#6e6e73]">Max 1,000 URLs</span>
          <input type="file" accept=".csv,text/csv" class="sr-only" @change="onFileChange" />
        </label>

        <button type="submit" :disabled="!canSubmit || submitting"
          class="w-full rounded-full bg-accent px-4 py-3 text-[15px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-black/20">
          {{ submitting ? "Checking…" : "Check DR" }}
        </button>

        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
          <button type="button" class="whitespace-nowrap text-accent hover:underline" @click="toggleMode">
            {{ mode === "typed" ? "or upload a CSV" : "or type domains" }}
          </button>
          <span class="text-xs text-[#6e6e73]">Checked domains are added to the public directory.</span>
        </div>

        <p v-if="errorMsg" role="alert" class="text-sm text-red-600">{{ errorMsg }}</p>
        <p v-if="infoMsg" role="status" class="text-sm text-[#6e6e73]">{{ infoMsg }}</p>
      </form>

      <!-- Inline results for small typed checks -->
      <CheckResults v-if="inlineCheckId" :key="inlineCheckId" :batch-id="inlineCheckId" :show-title="false"
        @completed="completed = true" />

      <div v-if="completed" class="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <button type="button"
          class="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          @click="checkMore">
          Check more domains
        </button>
        <NuxtLink to="/domains"
          class="text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          See all domains →
        </NuxtLink>
      </div>

      <!-- My recent checks (browser-local) -->
      <ClientOnly>
        <section v-if="recent.length" class="mt-12" aria-labelledby="recent-heading">
          <div class="flex items-center justify-between">
            <h2 id="recent-heading" class="text-lg font-semibold tracking-tight text-[#1d1d1f]">My recent checks</h2>
            <button type="button"
              class="rounded text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              @click="clearRecent">
              Clear
            </button>
          </div>
          <ul class="mt-3 divide-y divide-black/5 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
            <li v-for="r in recent" :key="r.batchId">
              <NuxtLink :to="recentHref(r)"
                class="flex items-center justify-between gap-4 px-4 py-3 text-sm transition-colors hover:bg-black/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
                <span class="min-w-0 truncate font-medium text-[#1d1d1f]">{{ r.label }}</span>
                <span class="shrink-0 text-[#6e6e73]">
                  {{ r.total }} {{ r.total === 1 ? "domain" : "domains" }} · {{ checkedAgo(r.createdAt) }}
                </span>
              </NuxtLink>
            </li>
          </ul>
        </section>
      </ClientOnly>
    </div>
  </div>
</template>

<script setup lang="ts">
import { TYPED_MAX } from "~/server/utils/checkInput";

useHead({ title: "DR Checker: bulk Ahrefs Domain Rating checker" });

// Nothing per-visitor renders on the server: recent checks are <ClientOnly>
// and inline results load in the browser.
if (import.meta.server) {
  useResponseHeader("Cache-Control").value = "public, s-maxage=60, stale-while-revalidate=300";
}

const recent = ref<RecentCheck[]>([]);
const completed = ref(false);
onMounted(() => {
  recent.value = readRecent(recentStorage());
});

function clearRecent() {
  recent.value = [];
  writeRecent(recentStorage(), []);
}

const mode = ref<"typed" | "csv">("typed");
const domainsText = ref("");
const file = ref<File | null>(null);
const submitting = ref(false);
const errorMsg = ref("");
const infoMsg = ref("");
const textareaEl = ref<HTMLTextAreaElement | null>(null);
const typedCount = computed(() => typedDomainCount(domainsText.value));

const route = useRoute();
const router = useRouter();
const inlineCheckId = computed(() =>
  typeof route.query.check === "string" ? route.query.check : null,
);

watch(inlineCheckId, () => {
  completed.value = false;
});

const canSubmit = computed(() =>
  mode.value === "typed" ? domainsText.value.trim().length > 0 : !!file.value,
);

function toggleMode() {
  mode.value = mode.value === "typed" ? "csv" : "typed";
  errorMsg.value = "";
}

async function checkMore() {
  domainsText.value = "";
  errorMsg.value = "";
  infoMsg.value = "";
  mode.value = "typed";
  await router.replace({ query: {} });
  await nextTick();
  textareaEl.value?.focus();
}

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  file.value = target.files?.[0] ?? null;
}

async function onSubmit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  errorMsg.value = "";
  infoMsg.value = "";

  try {
    const res = await submitCheck(
      mode.value === "typed" ? { source: "typed", domains: domainsText.value } : { source: "csv", file: file.value! },
    );
    if (res.skipped) infoMsg.value = `Skipped ${res.skipped} entr${res.skipped === 1 ? "y" : "ies"} that weren't valid domains.`;
    recent.value = readRecent(recentStorage());

    if (res.display === "inline") {
      completed.value = false;
      await router.replace({ query: { check: res.batchId } });
      focusWhenPresent("check-results");
    } else {
      await navigateTo(`/results/${res.batchId}`);
    }
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage ?? "Check failed. Please try again.";
  } finally {
    submitting.value = false;
  }
}
</script>
