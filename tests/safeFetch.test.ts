import { describe, it, expect } from "vitest";
import { FetchBlocked, fetchSite, META_LIMITS, safeFetch, type NetDeps } from "../supabase/functions/fetch-meta/safeFetch";

function deps(routes: Record<string, () => Response>, dns: Record<string, string[]> = {}) {
  const calls: string[] = [];
  const net: NetDeps = {
    resolve: async (host) => dns[host] ?? ["93.184.216.34"],
    fetch: async (url) => {
      calls.push(url);
      const r = routes[url];
      if (!r) throw new TypeError(`network error for ${url}`);
      return r();
    },
  };
  return { net, calls };
}
const html = (body: string, status = 200) => () =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const redirect = (to: string) => () => new Response(null, { status: 301, headers: { location: to } });
const HTML_OPTS = { accept: "text/html", maxBytes: META_LIMITS.htmlMaxBytes, overflow: "truncate" as const, stopAtHeadEnd: true };

describe("safeFetch", () => {
  it("refuses a host that resolves to a private address, without fetching", async () => {
    const { net, calls } = deps({}, { "evil.test": ["10.0.0.5"] });
    await expect(safeFetch("https://evil.test/", net, HTML_OPTS)).rejects.toBeInstanceOf(FetchBlocked);
    expect(calls).toEqual([]);
  });

  it("re-checks every redirect hop: a redirect to 127.0.0.1 is refused", async () => {
    const { net, calls } = deps({ "https://a.test/": redirect("http://127.0.0.1/admin") });
    await expect(safeFetch("https://a.test/", net, HTML_OPTS)).rejects.toBeInstanceOf(FetchBlocked);
    expect(calls).toEqual(["https://a.test/"]);
  });

  it("refuses non-80/443 ports and non-http schemes", async () => {
    const { net, calls } = deps({ "https://a.test/": redirect("https://a.test:8080/") });
    await expect(safeFetch("https://a.test/", net, HTML_OPTS)).rejects.toBeInstanceOf(FetchBlocked);
    await expect(safeFetch("ftp://a.test/", net, HTML_OPTS)).rejects.toBeInstanceOf(FetchBlocked);
    expect(calls).toEqual(["https://a.test/"]);
  });

  it("gives up after 3 redirects", async () => {
    const { net } = deps({
      "https://a.test/": redirect("/1"),
      "https://a.test/1": redirect("/2"),
      "https://a.test/2": redirect("/3"),
      "https://a.test/3": redirect("/4"),
    });
    await expect(safeFetch("https://a.test/", net, HTML_OPTS)).rejects.toThrow(/too many redirects/);
  });

  it("follows up to 3 redirects and reports the final URL", async () => {
    const { net } = deps({ "https://a.test/": redirect("https://www.a.test/"), "https://www.a.test/": html("<head></head>") });
    const res = await safeFetch("https://a.test/", net, HTML_OPTS);
    expect(res.url).toBe("https://www.a.test/");
    expect(new TextDecoder().decode(res.body)).toBe("<head></head>");
  });

  it("stops reading HTML at </head> and truncates at the byte cap", async () => {
    const stream = () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("<head><title>x</title></HEAD>"));
            c.enqueue(new TextEncoder().encode("<body>" + "y".repeat(1_000_000)));
            c.close();
          },
        }),
        { headers: { "content-type": "text/html" } },
      );
    const { net } = deps({ "https://a.test/": stream });
    const res = await safeFetch("https://a.test/", net, HTML_OPTS);
    expect(res.body.length).toBeLessThan(META_LIMITS.htmlMaxBytes);
    const big = deps({ "https://b.test/": html("z".repeat(META_LIMITS.htmlMaxBytes + 10)) });
    const res2 = await safeFetch("https://b.test/", big.net, HTML_OPTS);
    expect(res2.body.length).toBe(META_LIMITS.htmlMaxBytes);
  });

  it("errors when an icon exceeds 100 KB", async () => {
    const big = () => new Response(new Uint8Array(META_LIMITS.iconMaxBytes + 1), { headers: { "content-type": "image/png" } });
    const { net } = deps({ "https://a.test/f.png": big });
    await expect(
      safeFetch("https://a.test/f.png", net, { accept: "image/*", maxBytes: META_LIMITS.iconMaxBytes, overflow: "error" }),
    ).rejects.toThrow(/too large/);
  });

  it("aborts every request through the shared per-domain deadline", async () => {
    const slow: NetDeps = {
      resolve: async () => ["93.184.216.34"],
      fetch: (_url, init) =>
        new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    };
    const deadline = AbortSignal.timeout(50);
    const started = Date.now();
    await expect(safeFetch("https://slow.test/", slow, { ...HTML_OPTS, signal: deadline })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("fetchSite", () => {
  it("falls back to http when https fails at the network level", async () => {
    const { net, calls } = deps({ "http://a.test/": html("<head></head>") });
    const res = await fetchSite("a.test", net);
    expect(res.url).toBe("http://a.test/");
    expect(calls).toEqual(["https://a.test/", "http://a.test/"]);
  });

  it("does not fall back when the target is blocked", async () => {
    const { net, calls } = deps({}, { "a.test": ["192.168.1.1"] });
    await expect(fetchSite("a.test", net)).rejects.toBeInstanceOf(FetchBlocked);
    expect(calls).toEqual([]);
  });
});
