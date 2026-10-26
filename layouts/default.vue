<template>
  <div class="md:flex">
    <!-- md+: persistent sidebar -->
    <div class="sticky top-0 hidden h-screen shrink-0 md:block">
      <AppSidebar />
    </div>

    <div class="min-w-0 flex-1">
      <!-- < md: slim top bar -->
      <header class="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-black/5 bg-white/70 px-4 backdrop-blur-xl md:hidden">
        <NuxtLink to="/" aria-current="false" class="font-semibold tracking-tight">DR Checker</NuxtLink>
        <button
          ref="menuButton"
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-black/5"
          aria-label="Open menu"
          aria-controls="mobile-drawer"
          :aria-expanded="open"
          @click="open = true"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </header>

      <main>
        <slot />
      </main>
    </div>

    <!-- < md: overlay drawer -->
    <div v-if="open" class="fixed inset-0 z-40 md:hidden" @keydown="onKeydown">
      <div class="absolute inset-0 bg-black/30" aria-hidden="true" @click="close" />
      <div
        id="mobile-drawer"
        ref="drawerEl"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        class="absolute inset-y-0 left-0 max-w-[85vw]"
      >
        <AppSidebar drawer />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { SIDEBAR_KEY } from "~/utils/navSection";

// Pre-paint: apply the stored collapsed state before first render (no flash).
// Vue never renders this state, so CDN-cached HTML stays identical for all users.
useHead({
  script: [
    {
      textContent: `try{if(localStorage.getItem('${SIDEBAR_KEY}')==='collapsed')document.documentElement.dataset.sidebar='collapsed'}catch(e){}`,
      tagPriority: "critical",
    },
  ],
});

const route = useRoute();
const open = ref(false);
const menuButton = ref<HTMLButtonElement | null>(null);
const drawerEl = ref<HTMLElement | null>(null);

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function close() {
  open.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    close();
    return;
  }
  if (e.key !== "Tab" || !drawerEl.value) return;
  const els = Array.from(drawerEl.value.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (!els.length) return;
  const first = els[0];
  const last = els[els.length - 1];
  const current = document.activeElement;
  if (e.shiftKey && (current === first || !drawerEl.value.contains(current))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (current === last || !drawerEl.value.contains(current))) {
    e.preventDefault();
    first.focus();
  }
}

watch(open, async (isOpen) => {
  await nextTick();
  if (isOpen) drawerEl.value?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  else menuButton.value?.focus();
});

watch(() => route.fullPath, close);
</script>
