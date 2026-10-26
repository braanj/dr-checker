<template>
  <aside
    class="flex h-full flex-col border-r border-black/5 bg-white"
    :class="drawer ? 'w-64' : 'w-56 [html[data-sidebar=collapsed]_&]:w-16'"
  >
    <NuxtLink to="/" aria-current="false" class="flex h-12 shrink-0 items-center gap-2 px-4 font-semibold tracking-tight">
      <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-xs text-white">DR</span>
      <span :class="labelClass">DR Checker</span>
    </NuxtLink>

    <nav aria-label="Main" class="flex-1 space-y-1 px-2 py-2">
      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        :title="item.label"
        :aria-label="item.label"
        :aria-current="active === item.section ? 'page' : undefined"
        class="flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors"
        :class="active === item.section ? 'bg-accent-light font-medium text-accent' : 'text-[#1d1d1f]/80 hover:bg-black/5'"
      >
        <svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path v-for="d in item.icon" :key="d" :d="d" />
        </svg>
        <span :class="labelClass">{{ item.label }}</span>
      </NuxtLink>
    </nav>

    <div class="shrink-0 border-t border-black/5 p-2">
      <button
        v-if="!drawer"
        type="button"
        class="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-[#6e6e73] transition-colors hover:bg-black/5"
        :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggle"
      >
        <svg class="h-5 w-5 shrink-0 [html[data-sidebar=collapsed]_&]:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m15 6-6 6 6 6" />
        </svg>
        <span :class="labelClass">Collapse</span>
      </button>
      <a
        href="https://github.com/braanj"
        class="block px-3 py-2 text-xs leading-snug text-[#6e6e73] transition-colors hover:text-accent"
        :class="drawer ? '' : '[html[data-sidebar=collapsed]_&]:hidden'"
      >
        Developed with ❤️ by Brahim Anjjar
      </a>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { navSection, SIDEBAR_KEY } from "~/utils/navSection";

const props = defineProps<{ drawer?: boolean }>();
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
