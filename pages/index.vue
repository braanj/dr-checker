<template>
  <div class="max-w-3xl mx-auto px-4 py-16">
    <h1 class="text-2xl font-semibold text-slate-900">Bulk Domain Rating Checker</h1>
    <p class="mt-2 text-slate-600">
      Upload a CSV of URLs (one per line, or a column named <code>url</code>). We'll create an
      account for you automatically and check each domain's Ahrefs DR. <NuxtLink class="underline" to="/docs">
        Find out how to use it.
      </NuxtLink>
    </p>

    <form class="mt-8 space-y-4" @submit.prevent="onSubmit">
      <label
        class="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white p-10 text-center cursor-pointer hover:border-slate-400">
        <span class="text-sm font-medium text-slate-700">
          {{ file ? file.name : "Click to choose a CSV file" }}
        </span>
        <span class="text-xs text-slate-400">Max 5,000 URLs</span>
        <input type="file" accept=".csv,text/csv" class="hidden" @change="onFileChange" />
      </label>

      <button type="submit" :disabled="!file || submitting"
        class="w-full rounded-md bg-slate-900 px-4 py-2.5 text-white font-medium disabled:opacity-40">
        {{ submitting ? "Uploading…" : "Analyze URLs" }}
      </button>

      <p v-if="errorMsg" class="text-sm text-red-600">{{ errorMsg }}</p>
    </form>

    <!-- Auto-generated credentials, shown once -->
    <div v-if="credentials" class="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <!-- <p class="text-sm font-semibold text-amber-900">Your account was created — save these credentials:</p>
      <dl class="mt-2 text-sm text-amber-900 space-y-1">
        <div><dt class="inline font-medium">Email:</dt> <dd class="inline">{{ credentials.email }}</dd></div>
        <div><dt class="inline font-medium">Password:</dt> <dd class="inline">{{ credentials.password }}</dd></div>
      </dl>
      <p class="mt-2 text-xs text-amber-700">This is the only time the password is shown.</p> -->
      <NuxtLink :to="`/results/${batchId}`"
        class="w-full text-center inline-block rounded-md bg-amber-900 px-4 py-2 text-sm font-medium text-white">
        View processing status →
      </NuxtLink>
    </div>

    <!-- Previously processed domains, across all users -->
    <div class="mt-16">
      <h2 class="text-lg font-semibold text-slate-900">Previously checked domains ({{ totalDomains }} total)</h2>
      <p class="mt-1 text-sm text-slate-500">Every domain this app has looked up so far.</p>

      <div class="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm border-collapse">
          <thead>
            <tr class="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
              <th class="py-2 px-4">Domain</th>
              <th class="py-2 px-4">DR</th>
              <th class="py-2 px-4">Checked on</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="domainsLoading">
              <td colspan="3" class="py-6 px-4 text-center text-slate-400">Loading…</td>
            </tr>
            <tr v-else-if="domains.length === 0">
              <td colspan="3" class="py-6 px-4 text-center text-slate-400">No domains checked yet.</td>
            </tr>
            <tr v-for="d in domains" :key="d.domain" class="border-b border-slate-100 last:border-0">
              <td class="py-2 px-4">{{ d.domain }}</td>
              <td class="py-2 px-4 font-medium">{{ d.dr ?? "—" }}</td>
              <td class="py-2 px-4 text-slate-500">{{ formatDate(d.checked_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="totalPages > 1" class="mt-3 flex items-center justify-between text-sm">
        <span class="text-slate-500">Page {{ domainsPage }} of {{ totalPages }} ({{ totalDomains }} total)</span>
        <div class="flex gap-2">
          <button class="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40" :disabled="domainsPage <= 1"
            @click="goToPage(domainsPage - 1)">
            Previous
          </button>
          <button class="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
            :disabled="domainsPage >= totalPages" @click="goToPage(domainsPage + 1)">
            Next
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const file = ref<File | null>(null);
const submitting = ref(false);
const errorMsg = ref("");
const credentials = ref<{ email: string; password: string } | null>(null);
const batchId = ref<string | null>(null);

const supabase = useSupabase();

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  file.value = target.files?.[0] ?? null;
}

async function onSubmit() {
  if (!file.value) return;
  submitting.value = true;
  errorMsg.value = "";

  try {
    const formData = new FormData();
    formData.append("file", file.value);

    const res = await $fetch<{
      batchId: string;
      totalUrls: number;
      skipped: number;
      credentials: { email: string; password: string };
    }>("/api/upload", { method: "POST", body: formData });

    credentials.value = res.credentials;
    batchId.value = res.batchId;

    // Sign the browser in as the newly created user so Realtime/RLS-gated
    // reads on the results page are authorized for their own data.
    await supabase.auth.signInWithPassword({
      email: res.credentials.email,
      password: res.credentials.password,
    });
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage ?? "Upload failed. Please try again.";
  } finally {
    submitting.value = false;
  }
}

// ---- Previously processed domains table (paginated, 20/page) ----

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

async function loadDomains(page: number) {
  domainsLoading.value = true;
  try {
    const res = await $fetch<{
      domains: DomainRow[];
      page: number;
      totalPages: number;
      total: number;
    }>("/api/domains", { query: { page } });

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

onMounted(() => loadDomains(1));
</script>
