<template>
  <aside
    class="flex h-full flex-col border-r border-[#ccc] bg-[#f3f3f3]"
    :class="drawer ? 'w-56' : 'w-40 [html[data-sidebar=collapsed]_&]:w-11'"
  >
    <NuxtLink to="/" aria-current="false" aria-label="DR Checker" class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent flex h-9 shrink-0 items-center gap-2 border-b border-[#ccc] px-3 text-[13px] font-semibold">
      <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-accent text-[10px] text-white">DR</span>
      <span :class="labelClass">DR Checker</span>
    </NuxtLink>

    <nav aria-label="Main" class="flex-1 space-y-px px-1.5 py-1.5">
      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        :title="item.label"
        :aria-label="item.label"
        :aria-current="active === item.section ? 'page' : undefined"
        class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent flex h-7 items-center gap-2 rounded-sm px-2 text-[12px]"
        :class="active === item.section ? 'bg-[#e0e0e0] font-semibold text-[#1d1d1f]' : 'text-[#333] hover:bg-[#e6e6e6]'"
      >
        <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path v-for="d in item.icon" :key="d" :d="d" />
        </svg>
        <span :class="labelClass">{{ item.label }}</span>
      </NuxtLink>
    </nav>

    <div class="shrink-0 border-t border-[#ccc] p-1.5">
      <button
        v-if="!drawer"
        type="button"
        class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent flex h-7 w-full items-center gap-2 rounded-sm px-2 text-[12px] text-[#555] hover:bg-[#e6e6e6]"
        :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggle"
      >
        <svg class="h-4 w-4 shrink-0 [html[data-sidebar=collapsed]_&]:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m15 6-6 6 6 6" />
        </svg>
        <span :class="labelClass">Collapse</span>
      </button>
      <p
        class="px-2 py-1 text-[11px] leading-snug text-[#555]"
        :class="drawer ? '' : '[html[data-sidebar=collapsed]_&]:hidden'"
      >
        Developed with ❤️ by
        <a href="https://anjjar.com/en" :class="creditLink">Brahim Anjjar</a>
        ·
        <a href="https://github.com/braanj" :class="creditLink">GitHub</a>
      </p>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { navSection, SIDEBAR_KEY } from "~/utils/navSection";

const props = defineProps<{ drawer?: boolean }>();
const creditLink = "rounded-sm hover:text-[#1d1d1f] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const route = useRoute();
const active = computed(() => navSection(route.path));

// Width and label visibility come from CSS on <html data-sidebar>, never from
// reactive state, so SSR (CDN-cached) and the client render identical markup.
const labelClass = computed(() =>
  props.drawer ? "sidebar-label" : "sidebar-label [html[data-sidebar=collapsed]_&]:hidden",
);

// Only used for the toggle button's label/title; set after mount.
const collapsed = ref(false);
onMounted(() => {
  collapsed.value = document.documentElement.dataset.sidebar === "collapsed";
});

function toggle() {
  const root = document.documentElement;
  const next = root.dataset.sidebar !== "collapsed";
  if (next) root.dataset.sidebar = "collapsed";
  else delete root.dataset.sidebar;
  collapsed.value = next;
  try {
    if (next) localStorage.setItem(SIDEBAR_KEY, "collapsed");
    else localStorage.removeItem(SIDEBAR_KEY);
  } catch {
    // storage unavailable: the toggle still works for this page view
  }
}

const items = [
  { to: "/", label: "Check", section: "check", icon: ["M20 6 9 17l-5-5"] },
  { to: "/domains", label: "Domains", section: "domains", icon: ["M3 6h18", "M3 12h18", "M3 18h18"] },
  { to: "/docs", label: "Docs", section: "docs", icon: ["M6 3h9l4 4v14H6z", "M14 3v5h5", "M9 13h6", "M9 17h6"] },
] as const;
</script>
