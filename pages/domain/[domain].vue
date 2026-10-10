<template>
  <div class="mx-auto max-w-3xl px-4 py-16">
    <NuxtLink to="/" class="text-sm text-[#6e6e73] transition-colors hover:text-accent">← Domain directory</NuxtLink>

    <template v-if="view">
      <div class="mt-6 flex items-center gap-4">
        <img v-if="view.meta?.favicon_url" :src="view.meta.favicon_url" alt="" width="40" height="40"
          class="h-10 w-10 shrink-0 rounded-lg" />
        <div class="min-w-0">
          <h1 class="break-all text-3xl font-semibold tracking-tight text-[#1d1d1f]">{{ view.domain }}</h1>
          <p class="text-sm text-[#6e6e73]">checked {{ checkedAgo(view.checked_at) }}</p>
        </div>
        <div class="ml-auto text-right">
          <div class="text-5xl font-semibold tracking-tight text-[#1d1d1f]">{{ view.dr }}</div>
          <div class="text-xs text-[#86868b]">Domain Rating</div>
        </div>
      </div>

      <div v-if="view.meta?.title || view.meta?.description"
        class="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <p class="text-xs font-medium text-[#86868b]">From the site</p>
        <p v-if="view.meta?.title" class="mt-1 font-medium text-[#1d1d1f]">{{ view.meta.title }}</p>
        <p v-if="view.meta?.description" class="mt-1 text-sm text-[#424245]">{{ view.meta.description }}</p>
      </div>

      <section class="mt-8 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <h2 class="text-sm font-medium text-[#1d1d1f]">DR over time</h2>
        <svg v-if="view.history.length > 1" class="mt-3 h-16 w-full" viewBox="0 0 300 60" preserveAspectRatio="none"
          role="img" :aria-label="`DR history for ${view.domain}`">
          <path :d="sparklinePath([...view.history].reverse().map((h) => h.dr), 300, 60)" fill="none"
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
            <tr v-for="h in view.history" :key="h.checked_at" class="border-t border-black/5">
              <td class="py-1.5">{{ new Date(h.checked_at).toLocaleDateString() }}</td>
              <td class="py-1.5 font-medium">{{ h.dr }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <div v-else class="mt-6">
      <h1 class="break-all text-3xl font-semibold tracking-tight text-[#1d1d1f]">
        We haven't checked {{ domainName }} yet
      </h1>
      <p class="mt-2 text-[#6e6e73]">Check it now. The result is added to the public directory.</p>
    </div>

    <button type="button" :disabled="checking || !param"
      class="mt-8 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-black/20"
      @click="recheck">
      {{ checking ? "Checking…" : view ? "Re-check" : "Check its DR now" }}
    </button>
    <p v-if="checkError" class="mt-3 text-sm text-red-600">{{ checkError }}</p>

    <CheckResults v-if="checkId" :key="checkId" :batch-id="checkId" :show-title="false" />
  </div>
</template>

<script setup lang="ts">
import type { DomainView } from "~/utils/domainView";
import type { CheckResponse } from "~/server/utils/createCheck";

const route = useRoute();
const config = useRuntimeConfig();

const raw = String(route.params.domain ?? "");
const param = resolveDomainParam(raw);
if (param && !param.canonical) {
  await navigateTo(domainPath(param.domain), { redirectCode: 301 });
}
const domainName = param?.domain ?? raw;

const { data: view } = param
  ? await useFetch<DomainView>(`/api/domain/${encodeURIComponent(param.domain)}`, { key: `domain-${param.domain}` })
  : { data: ref<DomainView | null>(null) };

if (!view.value) {
  if (import.meta.server) setResponseStatus(useRequestEvent()!, 404);
  useHead({
    title: `${domainName}: not checked yet | DR Checker`,
    meta: [{ name: "robots", content: "noindex" }],
  });
} else {
  useResponseHeader("Cache-Control").value = "public, s-maxage=600, stale-while-revalidate=3600";
  const seo = domainSeo(view.value, config.public.siteUrl as string);
  useHead({
    title: seo.title,
    meta: [
      { name: "description", content: seo.description },
      { property: "og:title", content: seo.title },
      { property: "og:description", content: seo.description },
    ],
    link: [{ rel: "canonical", href: seo.canonical }],
  });
}

const checking = ref(false);
const checkError = ref("");
const checkId = ref<string | null>(null);

async function recheck() {
  if (!param) return;
  checking.value = true;
  checkError.value = "";
  try {
    const res = await $fetch<CheckResponse>("/api/check", { method: "POST", body: { domains: param.domain } });
    checkId.value = res.batchId;
  } catch (e: any) {
    checkError.value = e?.data?.statusMessage ?? "Check failed. Please try again.";
  } finally {
    checking.value = false;
  }
}
</script>
