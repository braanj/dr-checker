// The only way fetch-meta reaches the internet (ADR 0003): scheme/port
// allowlist, address check on every hop, manual redirects (≤3), per-request
// timeout plus a shared per-domain deadline, and byte caps. I/O is injected.

import { isBlockedAddress } from "./netguard.ts";

export const META_LIMITS = {
  requestTimeoutMs: 8_000,
  maxRedirects: 3,
  htmlMaxBytes: 512 * 1024,
  iconMaxBytes: 100 * 1024,
  perDomainMs: 20_000,
  runBudgetMs: 60_000,
  maxDomainsPerRun: 5,
  iconCandidates: 2,
} as const;

const USER_AGENT = "DRCheckerBot/1.0 (+https://dr-bulkchecker.netlify.app)";

export interface NetDeps {
  resolve(host: string, signal?: AbortSignal): Promise<string[]>;
  fetch(url: string, init: RequestInit): Promise<Response>;
}

export class FetchBlocked extends Error {}

export interface SafeFetchOpts {
  accept: string;
  maxBytes: number;
  overflow: "truncate" | "error";
  stopAtHeadEnd?: boolean;
  signal?: AbortSignal;
}

export interface FetchedBody {
  url: string;
  status: number;
  contentType: string;
  body: Uint8Array;
}

// A/AAAA results: "no records" (NotFound) on one family is normal; any other
// lookup failure (SERVFAIL, timeout) fails closed rather than trusting the
// other family alone.
export function combineLookups(a: PromiseSettledResult<string[]>, aaaa: PromiseSettledResult<string[]>): string[] {
  const out: string[] = [];
  for (const r of [a, aaaa]) {
    if (r.status === "fulfilled") out.push(...r.value);
    else if ((r.reason as Error)?.name !== "NotFound") throw new Error(`DNS lookup failed: ${(r.reason as Error)?.message ?? r.reason}`);
  }
  return out;
}

async function checkUrl(url: URL, deps: NetDeps, signal?: AbortSignal): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchBlocked(`scheme ${url.protocol}`);
  if (url.port !== "" && url.port !== "80" && url.port !== "443") throw new FetchBlocked(`port ${url.port}`);
  if (url.username || url.password) throw new FetchBlocked("credentials in URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  signal?.throwIfAborted();
  const addresses = /^[\d.]+$/.test(host) || host.includes(":") ? [host] : await deps.resolve(host, signal);
  if (addresses.length === 0) throw new Error(`DNS: no address for ${host}`);
  const blocked = addresses.find(isBlockedAddress);
  if (blocked) throw new FetchBlocked(`blocked address ${blocked}`);
}

// Incremental `</head>` check that stays linear on any chunking: it only keeps
// a short tail (long enough for `</head` + spaces + `>` split across pieces).
export function headEndDetector(): (piece: string) => boolean {
  let tail = "";
  return (piece) => {
    tail = tail.slice(-32) + piece;
    if (/<\/head\s*>/i.test(tail)) return true;
    if (tail.length > 64) tail = tail.slice(-32);
    return false;
  };
}

async function readCapped(res: Response, opts: SafeFetchOpts): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const seenHeadEnd = headEndDetector();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > opts.maxBytes) {
        if (opts.overflow === "error") throw new Error(`too large (> ${opts.maxBytes} bytes)`);
        chunks.push(value.slice(0, opts.maxBytes - total));
        total = opts.maxBytes;
        break;
      }
      chunks.push(value);
      total += value.length;
      if (opts.stopAtHeadEnd) {
        if (seenHeadEnd(decoder.decode(value, { stream: true }))) break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export async function safeFetch(start: string, deps: NetDeps, opts: SafeFetchOpts): Promise<FetchedBody> {
  let url: URL;
  try {
    url = new URL(start);
  } catch {
    throw new FetchBlocked(`invalid URL ${start}`);
  }
  for (let hop = 0; ; hop++) {
    await checkUrl(url, deps, opts.signal);
    const timeout = AbortSignal.timeout(META_LIMITS.requestTimeoutMs);
    const res = await deps.fetch(url.href, {
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT, Accept: opts.accept },
      signal: opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout,
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      if (hop >= META_LIMITS.maxRedirects) throw new FetchBlocked("too many redirects");
      url = new URL(location, url);
      continue;
    }
    return {
      url: url.href,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      body: await readCapped(res, opts),
    };
  }
}

export async function fetchSite(domain: string, deps: NetDeps, signal?: AbortSignal): Promise<FetchedBody> {
  const opts: SafeFetchOpts = {
    accept: "text/html,application/xhtml+xml",
    maxBytes: META_LIMITS.htmlMaxBytes,
    overflow: "truncate",
    stopAtHeadEnd: true,
    signal,
  };
  try {
    return await safeFetch(`https://${domain}/`, deps, opts);
  } catch (err) {
    // fall back to http only for connection/TLS/DNS failures, never after a
    // timeout or abort (a tarpit must not be hit twice)
    const name = (err as Error)?.name;
    if (err instanceof FetchBlocked || signal?.aborted || name === "TimeoutError" || name === "AbortError") throw err;
    return await safeFetch(`http://${domain}/`, deps, opts);
  }
}
