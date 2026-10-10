<template>
  <div>
    <!-- Hero -->
    <section class="bg-hero-radial px-4 pb-14 pt-16 text-center sm:pb-20 sm:pt-24">
      <h1 class="text-4xl font-semibold tracking-tight text-[#1d1d1f] sm:text-5xl">
        Domain Rating Checker
      </h1>
      <p class="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-[#6e6e73]">
        Check the Ahrefs DR of any domain — type a few, or upload a CSV of up to 1,000.
        <NuxtLink class="text-accent hover:underline" to="/docs">
          Find out how to use it.
        </NuxtLink>
      </p>
    </section>

    <div class="mx-auto max-w-2xl px-4 pb-24">
      <form class="space-y-4" @submit.prevent="onSubmit">
        <textarea v-if="mode === 'typed'" v-model="domainsText" rows="4"
          placeholder="example.com, another-site.org&#10;one per line or comma-separated (max 100)"
          aria-label="Domains to check"
          class="w-full rounded-2xl border border-black/10 bg-white p-4 text-[15px] text-[#1d1d1f] shadow-sm transition-colors focus:border-accent/50 focus:outline-none" />

        <label v-else
          class="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-black/15 bg-white p-12 text-center shadow-sm transition-colors cursor-pointer hover:border-accent/50 hover:bg-accent-light/40">
          <span class="text-[15px] font-medium text-[#1d1d1f]">
            {{ file ? file.name : "Click to choose a CSV file" }}
          </span>
          <span class="text-xs text-[#86868b]">Max 1,000 URLs</span>
          <input type="file" accept=".csv,text/csv" class="hidden" @change="onFileChange" />
        </label>

        <button type="submit" :disabled="!canSubmit || submitting"
          class="w-full rounded-full bg-accent px-4 py-3 text-[15px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-black/20">
          {{ submitting ? "Checking…" : "Check DR" }}
        </button>

        <div class="flex items-center justify-between text-sm">
          <button type="button" class="text-accent hover:underline" @click="toggleMode">
            {{ mode === "typed" ? "or upload a CSV" : "or type domains" }}
          </button>
          <span class="text-xs text-[#86868b]">Checked domains are added to the public directory below.</span>
        </div>

        <p v-if="errorMsg" class="text-sm text-red-600">{{ errorMsg }}</p>
        <p v-if="infoMsg" class="text-sm text-[#6e6e73]">{{ infoMsg }}</p>
      </form>

      <!-- Inline results for small typed checks -->
      <CheckResults v-if="inlineCheckId" :key="inlineCheckId" :batch-id="inlineCheckId" :show-title="false"
        @completed="loadDomains(domainsPage)" />

      <!-- Domain directory: every checked domain, across all users -->
      <div class="mt-20">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">
          Domain directory
          <span class="text-[#86868b]">({{ totalDomains }})</span>
        </h2>
        <p class="mt-1 text-sm text-[#6e6e73]">Every domain checked so far, with its latest DR.</p>

        <!-- Filters & sort -->
        <div class="mt-5 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label class="flex flex-col gap-1 text-xs font-medium text-[#6e6e73]">
              Domain contains
              <input v-model="domainSearch" type="text" placeholder="example.com"
                class="rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1d1d1f] transition-colors focus:border-accent/50 focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1 text-xs font-medium text-[#6e6e73]">
              TLD
              <input v-model="tldFilter" type="text" placeholder="com"
                class="rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1d1d1f] transition-colors focus:border-accent/50 focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1 text-xs font-medium text-[#6e6e73]">
              DR min
              <input v-model="drMin" type="number" min="0" max="100" placeholder="0"
                class="rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1d1d1f] transition-colors focus:border-accent/50 focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1 text-xs font-medium text-[#6e6e73]">
              DR max
              <input v-model="drMax" type="number" min="0" max="100" placeholder="100"
                class="rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1d1d1f] transition-colors focus:border-accent/50 focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1 text-xs font-medium text-[#6e6e73]">
              Checked from
              <input v-model="checkedFrom" type="date"
                class="rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1d1d1f] transition-colors focus:border-accent/50 focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1 text-xs font-medium text-[#6e6e73]">
              Checked to
              <input v-model="checkedTo" type="date"
                class="rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1d1d1f] transition-colors focus:border-accent/50 focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1 text-xs font-medium text-[#6e6e73]">
              Sort by
              <select v-model="sortBy"
                class="rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1d1d1f] transition-colors focus:border-accent/50 focus:outline-none">
                <option value="checked_at">Checked on</option>
                <option value="domain">Domain</option>
                <option value="dr">DR</option>
              </select>
            </label>
            <label class="flex flex-col gap-1 text-xs font-medium text-[#6e6e73]">
              Direction
              <select v-model="sortDir"
                class="rounded-lg border border-black/10 px-3 py-2 text-sm text-[#1d1d1f] transition-colors focus:border-accent/50 focus:outline-none">
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </label>
          </div>
          <button v-if="hasActiveFilters" type="button"
            class="mt-3 text-sm text-accent hover:underline" @click="clearFilters">
            Clear filters
          </button>
        </div>

        <div class="mt-5 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[480px] text-sm border-collapse table-fixed">
              <thead>
                <tr class="text-left text-[#6e6e73] border-b border-black/5">
                  <th class="py-3 px-4 font-medium">Domain</th>
                  <th class="w-20 py-3 px-4 font-medium">DR</th>
                  <th class="w-40 py-3 px-4 font-medium">Checked on</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="domainsLoading">
                  <td colspan="3" class="py-8 px-4 text-center text-[#86868b]">Loading…</td>
                </tr>
                <tr v-else-if="domains.length === 0">
                  <td colspan="3" class="py-8 px-4 text-center text-[#86868b]">No domains checked yet.</td>
                </tr>
                <tr v-for="d in domains" :key="d.domain"
                  class="border-b border-black/5 last:border-0 transition-colors hover:bg-black/[0.02]">
                  <td class="py-2.5 px-4 break-all">
                    <NuxtLink :to="domainPath(d.domain)" class="transition-colors hover:text-accent">{{ d.domain }}</NuxtLink>
                  </td>
                  <td class="py-2.5 px-4 font-medium">{{ d.dr ?? "—" }}</td>
                  <td class="py-2.5 px-4 text-[#6e6e73]">{{ formatDate(d.checked_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-if="totalPages > 1" class="mt-4 flex items-center justify-between text-sm">
          <span class="text-[#6e6e73]">Page {{ domainsPage }} of {{ totalPages }} ({{ totalDomains }} total)</span>
          <div class="flex gap-2">
            <button
              class="rounded-full border border-black/10 px-4 py-1.5 text-[#1d1d1f] transition-colors hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-black/10 disabled:hover:text-[#1d1d1f]"
              :disabled="domainsPage <= 1" @click="goToPage(domainsPage - 1)">
              Previous
            </button>
            <button
              class="rounded-full border border-black/10 px-4 py-1.5 text-[#1d1d1f] transition-colors hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-black/10 disabled:hover:text-[#1d1d1f]"
              :disabled="domainsPage >= totalPages" @click="goToPage(domainsPage + 1)">
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CheckResponse } from "~/server/utils/createCheck";

const mode = ref<"typed" | "csv">("typed");
const domainsText = ref("");
const file = ref<File | null>(null);
const submitting = ref(false);
const errorMsg = ref("");
const infoMsg = ref("");

const route = useRoute();
const router = useRouter();
const inlineCheckId = computed(() =>
  typeof route.query.check === "string" ? route.query.check : null,
);

const canSubmit = computed(() =>
  mode.value === "typed" ? domainsText.value.trim().length > 0 : !!file.value,
);

function toggleMode() {
  mode.value = mode.value === "typed" ? "csv" : "typed";
  errorMsg.value = "";
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
    let body: FormData | { domains: string };
    if (mode.value === "typed") {
      body = { domains: domainsText.value };
    } else {
      body = new FormData();
      body.append("file", file.value!);
    }

    const res = await $fetch<CheckResponse>("/api/check", { method: "POST", body });

    if (res.skipped) infoMsg.value = `Skipped ${res.skipped} entr${res.skipped === 1 ? "y" : "ies"} that weren't valid domains.`;

    if (res.display === "inline") {
      await router.replace({ query: { check: res.batchId } });
    } else {
      await navigateTo(`/results/${res.batchId}`);
    }
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage ?? "Check failed. Please try again.";
  } finally {
    submitting.value = false;
  }
}

// ---- Domain directory table (paginated, 20/page) ----

interface DomainRow {
  domain: string;
  dr: number | null;
  checked_at: string;
}

const domains = ref<DomainRow[]>([]);
const domainsLoading = ref(true);
const domainsPage = ref(1);
const totalPages = ref(1);
const totalDomains = ref(0);

const domainSearch = ref("");
const tldFilter = ref("");
const drMin = ref("");
const drMax = ref("");
const checkedFrom = ref("");
const checkedTo = ref("");
const sortBy = ref<"checked_at" | "domain" | "dr">("checked_at");
const sortDir = ref<"asc" | "desc">("desc");

const hasActiveFilters = computed(
  () =>
    !!domainSearch.value ||
    !!tldFilter.value ||
    !!drMin.value ||
    !!drMax.value ||
    !!checkedFrom.value ||
    !!checkedTo.value
);

async function loadDomains(page: number) {
  domainsLoading.value = true;
  try {
    const res = await $fetch<{
      domains: DomainRow[];
      page: number;
      totalPages: number;
      total: number;
    }>("/api/domains", {
      query: {
        page,
        sortBy: sortBy.value !== "checked_at" ? sortBy.value : undefined,
        sortDir: sortDir.value !== "desc" ? sortDir.value : undefined,
        domain: domainSearch.value.trim() || undefined,
        tld: tldFilter.value.trim() || undefined,
        drMin: drMin.value || undefined,
        drMax: drMax.value || undefined,
        checkedFrom: checkedFrom.value || undefined,
        checkedTo: checkedTo.value || undefined,
      },
    });

    domains.value = res.domains;
    domainsPage.value = res.page;
    totalPages.value = res.totalPages;
    totalDomains.value = res.total;
  } catch {
    // non-critical — leave the table empty rather than blocking the upload UI
  } finally {
    domainsLoading.value = false;
  }
}

function goToPage(page: number) {
  if (page < 1 || page > totalPages.value) return;
  loadDomains(page);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
function debouncedReload() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => loadDomains(1), 350);
}

watch([domainSearch, tldFilter, drMin, drMax], debouncedReload);
watch([checkedFrom, checkedTo, sortBy, sortDir], () => loadDomains(1));

function clearFilters() {
  domainSearch.value = "";
  tldFilter.value = "";
  drMin.value = "";
  drMax.value = "";
  checkedFrom.value = "";
  checkedTo.value = "";
  loadDomains(1);
}

onMounted(() => loadDomains(1));
</script>
