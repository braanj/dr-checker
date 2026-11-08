<template>
  <div class="space-y-3 px-3 py-2">
    <NuxtLink to="/domains" class="rounded-sm text-[#6e6e73] hover:text-[#1d1d1f] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">← Domain directory</NuxtLink>

    <template v-if="view">
      <div class="flex items-center gap-2">
        <img v-if="view.meta?.favicon_url" :src="view.meta.favicon_url" alt="" width="20" height="20" class="h-5 w-5 shrink-0" />
        <h1 class="min-w-0 [overflow-wrap:anywhere] text-[15px] font-semibold text-[#1d1d1f]">{{ view.domain }}</h1>
      </div>

      <dl class="grid max-w-3xl grid-cols-[7rem_minmax(0,1fr)] border border-b-0 border-[#ccc] sm:grid-cols-[7rem_minmax(0,1fr)_7rem_minmax(0,1fr)]">
        <dt class="border-b border-[#e3e3e3] bg-[#f3f3f3] px-1.5 py-[3px] text-[#555]">Domain Rating</dt>
        <dd class="min-w-0 border-b border-[#e3e3e3] px-1.5 py-[3px] [overflow-wrap:anywhere] flex items-center gap-2">
          <span class="text-[15px] font-semibold tabular-nums">{{ formatDr(view.dr) }}</span>
          <DomainsDrDelta v-if="drChange !== null" :change="drChange" />
        </dd>
        <dt class="border-b border-[#e3e3e3] bg-[#f3f3f3] px-1.5 py-[3px] text-[#555]">Checked</dt>
        <dd class="min-w-0 border-b border-[#e3e3e3] px-1.5 py-[3px] [overflow-wrap:anywhere]">
          <ClientOnly>{{ checkedAgo(view.checked_at) }}<template #fallback>on {{ isoDate(view.checked_at) }}</template></ClientOnly>
        </dd>
        <template v-if="view.meta?.title">
          <dt class="border-b border-[#e3e3e3] bg-[#f3f3f3] px-1.5 py-[3px] text-[#555]">Title</dt>
          <dd class="min-w-0 border-b border-[#e3e3e3] px-1.5 py-[3px] [overflow-wrap:anywhere]">{{ view.meta.title }}</dd>
        </template>
        <template v-if="nextRecheck">
          <dt class="border-b border-[#e3e3e3] bg-[#f3f3f3] px-1.5 py-[3px] text-[#555]">Next re-check</dt>
          <dd class="min-w-0 border-b border-[#e3e3e3] px-1.5 py-[3px] [overflow-wrap:anywhere]">around {{ nextRecheck }}</dd>
        </template>
        <template v-if="view.meta?.description">
          <dt class="border-b border-[#e3e3e3] bg-[#f3f3f3] px-1.5 py-[3px] text-[#555]">Description</dt>
          <dd class="min-w-0 border-b border-[#e3e3e3] px-1.5 py-[3px] [overflow-wrap:anywhere] sm:col-span-3">{{ view.meta.description }}</dd>
        </template>
      </dl>

      <p class="text-[#555]">Domain Rating (DR) is Ahrefs' 0–100 score of how strong a site's backlink profile is.</p>

      <section class="max-w-3xl">
        <h2 class="panel-label">DR over time</h2>
        <svg v-if="days.length > 1" class="mt-1 h-16 w-full border border-[#e3e3e3]" viewBox="0 0 300 60" preserveAspectRatio="none"
          role="img" :aria-label="`DR history for ${view.domain}`">
          <path :d="sparklinePath([...days].reverse().map((h) => h.dr), 300, 60)" fill="none"
            stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" class="text-accent" />
        </svg>
        <table class="data-table mt-1 w-auto min-w-[16rem]">
          <thead>
            <tr>
              <th scope="col">Checked</th>
              <th scope="col" class="text-right">DR</th>
              <th scope="col" class="text-right">Δ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(h, i) in days" :key="h.checked_at">
              <td class="tabular-nums">{{ isoDate(h.checked_at) }}</td>
              <td class="text-right font-medium tabular-nums">{{ formatDr(h.dr) }}</td>
              <td class="text-right"><DomainsDrDelta :change="days[i + 1] ? h.dr - days[i + 1].dr : null" /></td>
            </tr>
          </tbody>
        </table>
      </section>

      <form @submit.prevent="checkAnother">
        <label for="another-domain" class="panel-label">Check another domain</label>
        <div class="mt-0.5 flex flex-wrap items-center gap-1.5">
          <input id="another-domain" v-model="another" type="text" inputmode="url" autocomplete="off"
            autocapitalize="off" spellcheck="false" placeholder="example.com"
            class="input-sm w-56 min-w-0" />
          <button type="submit" :disabled="!another.trim() || anotherChecking" class="btn-sm btn-primary">
            {{ anotherChecking ? "Checking…" : "Check DR" }}
          </button>
          <NuxtLink to="/" class="rounded-sm text-[#0058b0] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Check up to 100 domains at once →</NuxtLink>
        </div>
        <p v-if="anotherError" role="alert" class="mt-1 text-red-600">{{ anotherError }}</p>
      </form>
    </template>

    <div v-else-if="param">
      <h1 class="[overflow-wrap:anywhere] text-[15px] font-semibold text-[#1d1d1f]">
        We haven't checked {{ domainName }} yet
      </h1>
      <p class="text-[#6e6e73]">Check it now. The result is added to the public directory.</p>
    </div>
    <div v-else>
      <h1 class="[overflow-wrap:anywhere] text-[15px] font-semibold text-[#1d1d1f]">That isn't a valid domain</h1>
      <p class="text-[#6e6e73]">Domain pages look like <code>/domain/example.com</code>.</p>
    </div>

    <button v-if="param && !nextRecheck" type="button" :disabled="checking || !param" class="btn-sm btn-primary" @click="recheck">
      {{ checking ? "Checking…" : view ? "Re-check" : "Check its DR now" }}
    </button>
    <p v-if="checkError" role="alert" class="text-red-600">{{ checkError }}</p>
    <p v-if="param && !view">
      <NuxtLink to="/" class="rounded-sm text-[#0058b0] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Check up to 100 domains at once →</NuxtLink>
    </p>

    <CheckResults v-if="checkId" :key="checkId" :batch-id="checkId" :show-title="false" />
  </div>
</template>

<script setup lang="ts">
import type { DomainView } from "~/utils/domainView";

const route = useRoute();
const config = useRuntimeConfig();

const raw = String(route.params.domain ?? "");
const param = resolveDomainParam(raw);
const redirecting = !!param && !param.canonical;
if (redirecting) {
  // stops rendering; the rest of setup must not run for the old URL
  await navigateTo(domainPath(param!.domain), { redirectCode: 301 });
}
const domainName = param?.domain ?? raw;

const { data: view, error: fetchError } = param && !redirecting
  ? await useFetch<DomainView>(`/api/domain/${encodeURIComponent(param.domain)}`, { key: `domain-${param.domain}` })
  : { data: ref<DomainView | null>(null), error: ref(null) };

// while redirecting, nothing below may set a status or head tags (a 404
// here would override the 301)
const pageState = redirecting ? "redirect" : domainPageState(view.value, fetchError.value);
if (pageState === "unavailable") {
  throw createError({ statusCode: 503, statusMessage: "Domain data is temporarily unavailable", fatal: true });
}
if (pageState === "unknown") {
  if (import.meta.server) setResponseStatus(useRequestEvent()!, 404);
  useHead({
    title: `${domainName}: not checked yet | DR Checker`,
    meta: [{ name: "robots", content: "noindex" }],
  });
} else if (view.value) {
  useResponseHeader("Cache-Control").value = "public, s-maxage=600, stale-while-revalidate=3600";
  const seo = domainSeo(view.value, config.public.siteUrl as string);
  useHead({
    title: seo.title,
    meta: [
      { name: "description", content: seo.description },
      { property: "og:title", content: seo.title },
      { property: "og:description", content: seo.description },
      { property: "og:url", content: seo.canonical },
      { property: "og:type", content: "website" },
    ],
    link: [{ rel: "canonical", href: seo.canonical }],
  });
}

const days = computed(() => (view.value ? historyByDay(view.value.history) : []));
// Same rule as the directory's dr_change: latest reading minus the one before it.
const drChange = computed(() => {
  const h = view.value?.history ?? [];
  return h.length > 1 ? h[0].dr - h[1].dr : null;
});
const nextRecheck = view.value ? nextAutoRecheck(view.value.checked_at, new Date()) : null;

const checking = ref(false);
const checkError = ref("");
const checkId = ref<string | null>(null);

async function recheck() {
  if (!param) return;
  checking.value = true;
  checkError.value = "";
  try {
    const res = await submitCheck({ source: "typed", domains: param.domain });
    checkId.value = res.batchId;
    focusWhenPresent("check-results");
  } catch (e: any) {
    checkError.value = e?.data?.statusMessage ?? "Check failed. Please try again.";
  } finally {
    checking.value = false;
  }
}

const another = ref("");
const anotherChecking = ref(false);
const anotherError = ref("");

async function checkAnother() {
  if (!another.value.trim()) return;
  anotherChecking.value = true;
  anotherError.value = "";
  try {
    const res = await submitCheck({ source: "typed", domains: another.value });
    track("domain_page_check", { rows: res.total });
    const inline = res.display === "inline";
    await navigateTo(recentHref({ batchId: res.batchId, inline }));
    if (inline) focusWhenPresent("check-results");
  } catch (e: any) {
    anotherError.value = e?.data?.statusMessage ?? "Check failed. Please try again.";
  } finally {
    anotherChecking.value = false;
  }
}
</script>
