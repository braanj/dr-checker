<template>
  <div class="mx-auto max-w-3xl px-4 py-16">
    <NuxtLink to="/domains" class="text-sm text-[#6e6e73] transition-colors hover:text-accent">← Domain directory</NuxtLink>

    <template v-if="view">
      <div class="mt-6 flex items-center gap-4">
        <img v-if="view.meta?.favicon_url" :src="view.meta.favicon_url" alt="" width="40" height="40"
          class="h-10 w-10 shrink-0 rounded-lg" />
        <div class="min-w-0">
          <h1 class="[overflow-wrap:anywhere] text-3xl font-semibold tracking-tight text-[#1d1d1f]">{{ view.domain }}</h1>
          <p class="text-sm text-[#6e6e73]">
            checked
            <ClientOnly>{{ checkedAgo(view.checked_at) }}<template #fallback>on {{ isoDate(view.checked_at) }}</template></ClientOnly>
          </p>
        </div>
        <div class="ml-auto text-right">
          <div class="text-5xl font-semibold tracking-tight text-[#1d1d1f]">{{ formatDr(view.dr) }}</div>
          <div class="text-xs text-[#6e6e73]">Domain Rating</div>
        </div>
      </div>

      <section class="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <p class="text-sm text-[#424245]">
          Domain Rating (DR) is Ahrefs' 0–100 score of how strong a site's backlink profile is.
        </p>
        <form class="mt-4" @submit.prevent="checkAnother">
          <label for="another-domain" class="text-sm font-medium text-[#1d1d1f]">Check another domain</label>
          <div class="mt-1.5 flex flex-wrap gap-2">
            <input id="another-domain" v-model="another" type="text" inputmode="url" autocomplete="off"
              autocapitalize="off" spellcheck="false" placeholder="example.com"
              class="min-w-0 flex-1 basis-48 rounded-full border border-black/10 bg-white px-4 py-2.5 text-[15px] text-[#1d1d1f] transition-colors focus:border-accent/50 focus:outline-none" />
            <button type="submit" :disabled="!another.trim() || anotherChecking"
              class="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-black/20">
              {{ anotherChecking ? "Checking…" : "Check DR" }}
            </button>
          </div>
          <p v-if="anotherError" role="alert" class="mt-2 text-sm text-red-600">{{ anotherError }}</p>
        </form>
        <NuxtLink to="/"
          class="mt-3 inline-block text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          Check up to 100 domains at once →
        </NuxtLink>
      </section>

      <div v-if="view.meta?.title || view.meta?.description"
        class="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <p class="text-xs font-medium text-[#6e6e73]">From the site</p>
        <p v-if="view.meta?.title" class="mt-1 font-medium text-[#1d1d1f]">{{ view.meta.title }}</p>
        <p v-if="view.meta?.description" class="mt-1 text-sm text-[#424245]">{{ view.meta.description }}</p>
      </div>

      <section class="mt-8 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <h2 class="text-sm font-medium text-[#1d1d1f]">DR over time</h2>
        <svg v-if="days.length > 1" class="mt-3 h-16 w-full" viewBox="0 0 300 60" preserveAspectRatio="none"
          role="img" :aria-label="`DR history for ${view.domain}`">
          <path :d="sparklinePath([...days].reverse().map((h) => h.dr), 300, 60)" fill="none"
            stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" class="text-accent" />
        </svg>
        <table class="mt-3 w-full text-sm">
          <thead>
            <tr class="text-left text-[#6e6e73]">
              <th class="py-1.5 font-medium">Checked</th>
              <th class="py-1.5 font-medium">DR</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in days" :key="h.checked_at" class="border-t border-black/5">
              <td class="py-1.5">{{ isoDate(h.checked_at) }}</td>
              <td class="py-1.5 font-medium">{{ formatDr(h.dr) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <div v-else-if="param" class="mt-6">
      <h1 class="[overflow-wrap:anywhere] text-3xl font-semibold tracking-tight text-[#1d1d1f]">
        We haven't checked {{ domainName }} yet
      </h1>
      <p class="mt-2 text-[#6e6e73]">Check it now. The result is added to the public directory.</p>
    </div>
    <div v-else class="mt-6">
      <h1 class="[overflow-wrap:anywhere] text-3xl font-semibold tracking-tight text-[#1d1d1f]">That isn't a valid domain</h1>
      <p class="mt-2 text-[#6e6e73]">Domain pages look like <code>/domain/example.com</code>.</p>
    </div>

    <p v-if="nextRecheck" class="mt-8 text-sm text-[#6e6e73]">Next automatic re-check around {{ nextRecheck }}</p>
    <button v-else-if="param" type="button" :disabled="checking || !param"
      class="mt-8 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-black/20"
      @click="recheck">
      {{ checking ? "Checking…" : view ? "Re-check" : "Check its DR now" }}
    </button>
    <p v-if="checkError" role="alert" class="mt-3 text-sm text-red-600">{{ checkError }}</p>
    <p v-if="param && !view" class="mt-4">
      <NuxtLink to="/"
        class="text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        Check up to 100 domains at once →
      </NuxtLink>
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
