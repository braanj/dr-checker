<template>
  <div class="mx-auto max-w-3xl px-4 py-16">
    <NuxtLink to="/" class="text-sm text-[#6e6e73] transition-colors hover:text-accent">← Back to checker</NuxtLink>

    <h1 class="mt-4 text-4xl font-semibold tracking-tight text-[#1d1d1f]">Documentation</h1>
    <p class="mt-2 text-lg text-[#6e6e73]">How to use the Domain Rating Checker.</p>

    <!-- Table of contents -->
    <nav class="mt-8 rounded-2xl border border-black/5 bg-white p-5 text-sm shadow-sm">
      <p class="font-medium text-[#1d1d1f] mb-2">On this page</p>
      <ol class="space-y-1 list-decimal list-inside text-[#6e6e73]">
        <li><a href="#overview" class="transition-colors hover:text-accent">Overview</a></li>
        <li><a href="#checking" class="transition-colors hover:text-accent">Checking domains</a></li>
        <li><a href="#csv-format" class="transition-colors hover:text-accent">Preparing your CSV file</a></li>
        <li><a href="#tracking" class="transition-colors hover:text-accent">Tracking progress</a></li>
        <li><a href="#results" class="transition-colors hover:text-accent">Reading the results</a></li>
        <li><a href="#download" class="transition-colors hover:text-accent">Downloading results as CSV</a></li>
        <li><a href="#directory" class="transition-colors hover:text-accent">Domain directory</a></li>
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
          a domain's backlink profile is — for domains you type (up to 100) or upload as a CSV (up to
          1,000). Processing happens on the server and results update live as each domain finishes.
        </p>
        <p class="mt-3">
          There are no accounts: every check gets its own private results link. Every domain that gets
          a DR is added to the public <a href="#directory" class="text-accent hover:underline">domain directory</a>
          on the home page.
        </p>
      </section>

      <!-- Checking -->
      <section id="checking">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">2. Checking domains</h2>
        <ol class="mt-3 list-decimal list-inside space-y-1">
          <li>On the home page, type domains one per line or comma-separated.</li>
          <li>Click <strong>Check DR</strong>.</li>
          <li>
            Up to 10 domains show their results right below the form (the page URL updates, so you can
            reload or share it). More than 10 open a dedicated results page.
          </li>
        </ol>
        <ul class="mt-3 list-disc list-inside space-y-1">
          <li>Full URLs are fine: <code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">https://www.example.com/page</code> is checked as <code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">example.com</code>.</li>
          <li>Only a leading <code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">www.</code> is removed, so subdomains such as <code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">blog.example.com</code> are checked separately.</li>
          <li>Entries without a dot (e.g. <code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">localhost</code>) are skipped.</li>
          <li>Prefer a file? Click <strong>or upload a CSV</strong> below the button.</li>
        </ul>
      </section>

      <!-- CSV format -->
      <section id="csv-format">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">3. Preparing your CSV file</h2>
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
          <li>Files exported from Excel (with a byte-order mark or Windows line endings) work as-is.</li>
          <li>Rows that can't be parsed into a valid domain are skipped and don't count toward the limit.</li>
          <li>Maximum <strong>1,000 valid URLs</strong> per file.</li>
        </ul>
      </section>

      <!-- Tracking -->
      <section id="tracking">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">4. Tracking progress</h2>
        <p class="mt-3">
          The results show a progress bar (<code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">processed / total</code>) and an overall status:
        </p>
        <ul class="mt-2 space-y-1.5">
          <li><span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-black/5 text-[#6e6e73]">pending</span> — queued behind other checks; nothing picked up yet</li>
          <li><span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-accent-light text-accent">processing</span> — actively being checked</li>
          <li><span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-700">completed</span> — every URL has a result</li>
          <li><span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-700">failed</span> — finished, but none of the domains could be checked (every row is an error)</li>
        </ul>
        <p class="mt-3">
          This updates automatically — there's nothing to click or refresh. Domains already in the
          directory (checked in the last 30 days) appear instantly; the rest fill in as each DR check
          finishes.
        </p>
      </section>

      <!-- Results -->
      <section id="results">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">5. Reading the results</h2>
        <p class="mt-3">Each row in the results table shows:</p>
        <ul class="mt-2 list-disc list-inside space-y-1">
          <li><strong>URL</strong> — exactly what you submitted</li>
          <li><strong>Domain</strong> — the host the URL was resolved to (DR is scored per domain, not per page)</li>
          <li><strong>DR</strong> — the Ahrefs Domain Rating, 0–100, or <code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">—</code> if not available, with when it was checked (e.g. "checked 12 days ago")</li>
          <li>
            <strong>Status</strong> —
            <span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-700">done</span>
            (DR found) or
            <span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-700">error</span>
            (could not be checked)
          </li>
        </ul>
        <p class="mt-3">A small badge next to the DR says where it came from:</p>
        <ul class="mt-2 space-y-1.5">
          <li><span class="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium bg-accent-light text-accent">live</span> — fetched from Ahrefs just now</li>
          <li><span class="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium bg-black/5 text-[#6e6e73]">cached</span> — from the directory, checked in the last 30 days</li>
          <li><span class="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-800">stale</span> — Ahrefs was unavailable after 3 tries, so this is the last known DR</li>
          <li><span class="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-800">retrying</span> — the last try failed temporarily (e.g. Ahrefs rate limit); it is retried automatically, up to 3 attempts — hover it to see the error</li>
        </ul>
        <p class="mt-3">
          An <strong>error</strong> saying "No DR data from Ahrefs" means Ahrefs has no rating for that
          domain; this is remembered for 7 days. Two URLs on the same domain always get the same DR.
        </p>
      </section>

      <!-- Download -->
      <section id="download">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">6. Downloading results as CSV</h2>
        <p class="mt-3">
          Once results start coming in, a <strong>Download CSV</strong> button appears above the table.
          The exported file has one row per submitted URL with columns
          <code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">url, domain, domain_rating, status, source, checked_at</code>.
        </p>
      </section>

      <!-- Directory -->
      <section id="directory">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">7. Domain directory</h2>
        <p class="mt-3">
          The home page lists every domain the tool has found a DR for (across everyone's checks), with
          its latest DR and the date it was checked, 20 per page. You can filter by name, TLD, DR range
          and check date, and sort by any column. Domains Ahrefs has no data for aren't listed.
        </p>
        <p class="mt-3">
          Click a domain to open its page: current DR, DR history and a <strong>Re-check</strong> button.
          Domain pages also show the site's favicon, title and description, refreshed monthly.
        </p>
      </section>

      <!-- Limits -->
      <section id="limits">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">8. Limits and things to know</h2>
        <ul class="mt-2 list-disc list-inside space-y-1">
          <li>Up to 100 typed domains or 1,000 CSV rows per check.</li>
          <li>Up to 10 checks per minute from the same network.</li>
          <li>A DR is reused for 30 days before it's checked again.</li>
          <li>DR is per host: <code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">blog.example.com</code> and <code class="rounded bg-black/5 px-1.5 py-0.5 text-[0.9em]">example.com</code> are separate entries.</li>
          <li>Everything you check (with a DR) becomes visible in the public directory.</li>
          <li>Processing speed depends on Ahrefs' rate limits — large files take longer; keep the results link and check back.</li>
        </ul>
      </section>

      <!-- FAQ -->
      <section id="faq">
        <h2 class="text-2xl font-semibold tracking-tight text-[#1d1d1f]">9. Troubleshooting / FAQ</h2>

        <div class="mt-4 space-y-5">
          <div>
            <p class="font-medium text-[#1d1d1f]">A row shows "error" — why?</p>
            <p class="mt-1">
              Usually the domain has no backlink data in Ahrefs (too new, unindexed, or malformed), or
              Ahrefs was unavailable after several retries. Double-check the domain resolves in a browser.
            </p>
          </div>
          <div>
            <p class="font-medium text-[#1d1d1f]">The progress bar seems stuck.</p>
            <p class="mt-1">
              Processing happens in small batches with pacing between checks to respect Ahrefs' rate
              limits, and failed lookups are retried after a short wait, so large files take time — this
              is expected, not a hang.
            </p>
          </div>
          <div>
            <p class="font-medium text-[#1d1d1f]">I lost my results link.</p>
            <p class="mt-1">
              Just check the domains again — anything checked in the last 30 days comes back instantly
              from the directory.
            </p>
          </div>
          <div>
            <p class="font-medium text-[#1d1d1f]">Can I check the same domain twice?</p>
            <p class="mt-1">
              Yes, but within 30 days of the last check you'll get the cached DR (marked "cached")
              rather than a fresh lookup.
            </p>
          </div>
          <div>
            <p class="font-medium text-[#1d1d1f]">I got "Too many checks".</p>
            <p class="mt-1">
              You've hit the limit of 10 checks per minute — wait a minute and try again.
            </p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
