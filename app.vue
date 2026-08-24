<template>
  <div class="min-h-screen bg-[#f5f5f7] text-[#1d1d1f] antialiased">
    <header class="sticky top-0 z-50 border-b border-black/5 bg-white/70 backdrop-blur-xl">
      <div class="mx-auto flex h-11 max-w-5xl items-center justify-between px-4 text-sm">
        <NuxtLink to="/" class="font-semibold tracking-tight text-[#1d1d1f]">
          DR Checker
        </NuxtLink>
        <nav class="flex items-center gap-6 text-[#1d1d1f]/80">
          <NuxtLink to="/docs" class="transition-colors hover:text-accent">Docs</NuxtLink>
        </nav>
      </div>
    </header>

    <NuxtPage />

    <footer class="border-t border-black/5 px-4 py-8 text-center text-xs text-[#6e6e73]">
      <a class="transition-colors hover:text-accent" href="https://github.com/braanj">
        Developed with ❤️ by Brahim Anjjar
      </a>
    </footer>
  </div>
</template>
