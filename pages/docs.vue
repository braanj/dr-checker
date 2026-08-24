<template>
  <div class="mx-auto max-w-3xl px-4 py-16">
    <NuxtLink to="/" class="text-sm text-[#6e6e73] transition-colors hover:text-accent">← Back to upload</NuxtLink>

    <h1 class="mt-4 text-4xl font-semibold tracking-tight text-[#1d1d1f]">Documentation</h1>
    <p class="mt-2 text-lg text-[#6e6e73]">How to use the Bulk Domain Rating Checker.</p>

    <!-- Table of contents -->
    <nav class="mt-8 rounded-2xl border border-black/5 bg-white p-5 text-sm shadow-sm">
      <p class="font-medium text-[#1d1d1f] mb-2">On this page</p>
      <ol class="space-y-1 list-decimal list-inside text-[#6e6e73]">
        <li><a href="#overview" class="transition-colors hover:text-accent">Overview</a></li>
        <li><a href="#csv-format" class="transition-colors hover:text-accent">Preparing your CSV file</a></li>
        <li><a href="#uploading" class="transition-colors hover:text-accent">Uploading and starting a check</a></li>
        <li><a href="#tracking" class="transition-colors hover:text-accent">Tracking progress</a></li>
        <li><a href="#results" class="transition-colors hover:text-accent">Reading the results</a></li>
        <li><a href="#download" class="transition-colors hover:text-accent">Downloading results as CSV</a></li>
        <li><a href="#history" class="transition-colors hover:text-accent">Previously checked domains</a></li>
        <li><a href="#limits" class="transition-colors hover:text-accent">Limits and things to know</a></li>
        <li><a href="#faq" class="transition-colors hover:text-accent">Troubleshooting / FAQ</a></li>
      </ol>
    </nav>

    <div class="mt-12 space-y-14 text-[15px] text-[#424245] leading-relaxed">
      <!-- Overview -->
      <section id="overview">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">1. Overview</h2>
        <p class="mt-3">
          This tool checks the <strong>Domain Rating (DR)</strong> — Ahrefs' 0–100 score for how strong
          a domain's backlink profile is — for a list of URLs you upload as a CSV. Processing happens on
          the server, so you can close the tab and come back to a saved link later; the results page
          updates live as each domain finishes.
        </p>
        <p class="mt-3">
          There's no sign-up form: submitting a file automatically creates an account behind the scenes
          and hands you a unique link to your results. That link is your only way back in, so keep it.
        </p>
      </section>

      <!-- CSV format -->
      <section id="csv-format">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">2. Preparing your CSV file</h2>
        <p class="mt-3">Two formats are accepted:</p>
        <ul class="mt-2 list-disc list-inside space-y-1">
          <li><strong>One URL per line</strong>, no header row, e.g.:</li>
        </ul>
        <pre class="mt-2 rounded-xl bg-[#1d1d1f] text-[#f5f5f7] text-xs p-4 overflow-x-auto">https://example.com/page
https://another-site.org
www.athirdsite.net/blog</pre>
        <ul class="mt-3 list-disc list-inside space-y-1">
          <li><strong>A column named <code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">url</code></strong>, with any other columns ignored, e.g.:</li>
        </ul>
        <pre class="mt-2 rounded-xl bg-[#1d1d1f] text-[#f5f5f7] text-xs p-4 overflow-x-auto">url,notes
https://example.com/page,homepage
https://another-site.org,competitor</pre>
        <p class="mt-3">
          Notes:
        </p>
        <ul class="mt-2 list-disc list-inside space-y-1">
          <li>The scheme (<code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">https://</code>) is optional — <code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">example.com</code> works too.</li>
          <li>Only the first column of each line is read; anything after the first comma is ignored.</li>
          <li>Rows that can't be parsed into a valid domain are silently skipped (see the upload summary).</li>
          <li>Maximum <strong>5,000 URLs</strong> per file.</li>
        </ul>
      </section>

      <!-- Uploading -->
      <section id="uploading">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">3. Uploading and starting a check</h2>
        <ol class="mt-3 list-decimal list-inside space-y-1">
          <li>On the home page, click the upload area and choose your CSV file.</li>
          <li>Click <strong>Analyze URLs</strong>.</li>
          <li>
            Within a moment you'll see a confirmation panel with auto-generated account credentials and
            a <strong>View processing status</strong> link — click it (or bookmark it) to open your
            results page.
          </li>
        </ol>
      </section>

      <!-- Tracking -->
      <section id="tracking">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">4. Tracking progress</h2>
        <p class="mt-3">
          The results page shows a progress bar (<code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">processed / total</code>) and an overall status:
        </p>
        <ul class="mt-2 space-y-1.5">
          <li><span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-black/5 text-[#6e6e73]">pending</span> — queued, not yet picked up</li>
          <li><span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-accent-light text-accent">processing</span> — actively being checked</li>
          <li><span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-700">completed</span> — every URL has a result</li>
        </ul>
        <p class="mt-3">
          This updates automatically — there's nothing to click or refresh. Each row in the table below
          the progress bar also updates individually as its own DR check finishes, so you can start
          reading results before the whole batch is done.
        </p>
      </section>

      <!-- Results -->
      <section id="results">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">5. Reading the results</h2>
        <p class="mt-3">Each row in the results table shows:</p>
        <ul class="mt-2 list-disc list-inside space-y-1">
          <li><strong>URL</strong> — exactly what you submitted</li>
          <li><strong>Domain</strong> — the root domain the URL was resolved to (DR is scored per domain, not per page)</li>
          <li><strong>DR</strong> — the Ahrefs Domain Rating, 0–100, or <code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">—</code> if not yet available</li>
          <li>
            <strong>Status</strong> —
            <span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-700">done</span>
            (DR found) or
            <span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-700">error</span>
            (could not be checked — usually because the domain has no backlink data)
          </li>
        </ul>
        <p class="mt-3">
          Two URLs on the same domain will always get the same DR, since DR is a domain-level metric.
        </p>
      </section>

      <!-- Download -->
      <section id="download">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">6. Downloading results as CSV</h2>
        <p class="mt-3">
          Once the batch reaches <strong>completed</strong>, a <strong>Download CSV</strong> button
          appears above the table. The exported file has one row per submitted URL with columns
          <code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">url, domain, domain_rating, status</code>.
        </p>
      </section>

      <!-- History -->
      <section id="history">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">7. Previously checked domains</h2>
        <p class="mt-3">
          The home page includes a table of every domain the tool has ever checked (across all users),
          with its most recent DR and the date it was checked, 20 per page. It's a quick way to see if a
          domain's already been looked up before running a new batch.
        </p>
      </section>

      <!-- Limits -->
      <section id="limits">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">8. Limits and things to know</h2>
        <ul class="mt-2 list-disc list-inside space-y-1">
          <li>Max 5,000 URLs per upload.</li>
          <li>DR is domain-level: <code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">blog.example.com</code> and <code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">example.com</code> resolve to the same score.</li>
          <li>Processing speed depends on Ahrefs' rate limits — large batches or busy periods take longer; leave the tab or bookmark and check back.</li>
          <li>There's no login system. The link shown after upload is the only way to return to a batch's results — save it somewhere safe.</li>
        </ul>
      </section>

      <!-- FAQ -->
      <section id="faq">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">9. Troubleshooting / FAQ</h2>

        <div class="mt-4 space-y-5">
          <div>
            <p class="font-medium text-[#1d1d1f]">A row shows "error" — why?</p>
            <p class="mt-1">
              Usually the domain has no backlink data in Ahrefs (too new, unindexed, or malformed).
              Double-check the domain resolves in a browser.
            </p>
          </div>
          <div>
            <p class="font-medium text-[#1d1d1f]">The progress bar seems stuck.</p>
            <p class="mt-1">
              Processing happens in small batches with pacing between checks to respect Ahrefs' rate
              limits, so large files take time — this is expected, not a hang. Leave the page open or
              come back later using your saved link.
            </p>
          </div>
          <div>
            <p class="font-medium text-[#1d1d1f]">I lost my results link.</p>
            <p class="mt-1">
              Unfortunately there's currently no way to recover it — there's no login/account recovery
              flow. You'll need to re-upload the CSV to start a new batch.
            </p>
          </div>
          <div>
            <p class="font-medium text-[#1d1d1f]">Can I check the same domain twice?</p>
            <p class="mt-1">
              Yes — each upload creates its own independent batch and result set, even if a domain was
              already checked before (you'll also see it in the "previously checked domains" table).
            </p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
