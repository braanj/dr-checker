<template>
  <div class="px-3 py-2">
    <h1 class="text-[15px] font-semibold text-[#1d1d1f]">Check Domain Rating</h1>
    <p class="text-[#6e6e73]">
      Type up to 100 domains or upload a CSV of up to 1,000.
      <NuxtLink class="rounded-sm text-[#0058b0] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" to="/docs">How it works</NuxtLink>
    </p>

    <form class="mt-2 space-y-1.5" @submit.prevent="onSubmit">
      <textarea v-if="mode === 'typed'" ref="textareaEl" v-model="domainsText" rows="3"
        placeholder="example.com, another-site.org&#10;one per line or comma-separated (max 100)"
        aria-label="Domains to check"
        class="input-sm block w-full" />

      <label v-else
        class="flex cursor-pointer items-center gap-2 rounded-sm border border-dashed border-[#999] bg-[#f8f8f8] px-3 py-3 hover:bg-[#f0f0f0] focus-within:ring-2 focus-within:ring-accent">
        <span class="font-medium text-[#1d1d1f]">
          {{ file ? file.name : "Click to choose a CSV file" }}
        </span>
        <span class="text-[11px] text-[#6e6e73]">Max 1,000 URLs</span>
        <input type="file" accept=".csv,text/csv" class="sr-only" @change="onFileChange" />
      </label>

      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="submit" :disabled="!canSubmit || submitting" class="btn-sm btn-primary">
          {{ submitting ? "Checking…" : "Check DR" }}
        </button>
        <button type="button" class="whitespace-nowrap rounded-sm text-[#0058b0] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" @click="toggleMode">
          {{ mode === "typed" ? "or upload a CSV" : "or type domains" }}
        </button>
        <span class="text-[11px] text-[#6e6e73]">Checked domains are added to the public directory.</span>
        <span v-if="mode === 'typed' && domainsText.trim()" class="ml-auto text-[11px] tabular-nums"
          :class="typedCount > TYPED_MAX ? 'text-red-600' : 'text-[#6e6e73]'">
          {{ typedCount }} / {{ TYPED_MAX }}
        </span>
      </div>

      <p v-if="errorMsg" role="alert" class="text-red-600">{{ errorMsg }}</p>
      <p v-if="infoMsg" role="status" class="text-[#6e6e73]">{{ infoMsg }}</p>
    </form>

    <!-- Inline results for small typed checks -->
    <CheckResults v-if="inlineCheckId" :key="inlineCheckId" class="mt-3" :batch-id="inlineCheckId" :show-title="false"
      @completed="completed = true" />

    <div v-if="completed" class="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      <button type="button"
        class="rounded-sm text-[#0058b0] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        @click="checkMore">
        Check more domains
      </button>
      <NuxtLink to="/domains"
        class="rounded-sm text-[#0058b0] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        See all domains →
      </NuxtLink>
    </div>

    <!-- My recent checks (browser-local) -->
    <ClientOnly>
      <section v-if="recent.length" class="mt-4" aria-labelledby="recent-heading">
        <div class="flex items-center gap-3">
          <h2 id="recent-heading" class="text-[13px] font-semibold text-[#1d1d1f]">My recent checks</h2>
          <button type="button"
            class="rounded-sm text-[11px] text-[#0058b0] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            @click="clearRecent">
            Clear
          </button>
        </div>
        <table class="data-table mt-1">
          <thead>
            <tr>
              <th scope="col">Check</th>
              <th scope="col" class="w-20 text-right">Domains</th>
              <th scope="col" class="w-28">Submitted</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in recent" :key="r.batchId">
              <td class="max-w-0 truncate">
                <NuxtLink :to="recentHref(r)"
                  class="rounded-sm font-medium text-[#0058b0] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{{ r.label }}</NuxtLink>
              </td>
              <td class="text-right tabular-nums">{{ r.total }}</td>
              <td class="whitespace-nowrap text-[#6e6e73]" :title="isoDate(r.createdAt)">{{ checkedAgo(r.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </ClientOnly>
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
