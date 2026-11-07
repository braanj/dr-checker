import { describe, it, expect } from "vitest";
import { extractMeta, iconExtension, normalizeMime } from "../supabase/functions/fetch-meta/parseHead";

const PAGE = "https://www.example.com/home/";

describe("extractMeta", () => {
  it("reads title and description, decoding entities and collapsing whitespace", () => {
    const html = `<html><HEAD><TITLE>  Tom &amp; Jerry\n  &#8211; Home </TITLE>
      <meta name="Description" content='Cats &quot;and&quot; mice'></HEAD><body><title>ignored</title>`;
    expect(extractMeta(html, PAGE)).toMatchObject({ title: "Tom & Jerry – Home", description: 'Cats "and" mice' });
  });

  it("falls back to Open Graph tags", () => {
    const html = `<head><meta property="og:title" content="OG T"><meta property=og:description content=OGD></head>`;
    expect(extractMeta(html, PAGE)).toMatchObject({ title: "OG T", description: "OGD" });
  });

  it("caps title at 200 and description at 500 characters", () => {
    const html = `<head><title>${"t".repeat(10_000)}</title><meta name="description" content="${"d".repeat(900)}"></head>`;
    const m = extractMeta(html, PAGE);
    expect(m.title).toHaveLength(200);
    expect(m.description).toHaveLength(500);
  });

  it("returns nulls for empty or missing tags and survives a missing </head>", () => {
    expect(extractMeta(`<head><title>   </title><meta name="description" content="">`, PAGE)).toMatchObject({
      title: null,
      description: null,
    });
    expect(() => extractMeta(`<head><meta name="description" content="unterminated`, PAGE)).not.toThrow();
  });

  it("orders favicon candidates: png/svg icon, other icon, apple-touch-icon, then /favicon.ico", () => {
    const html = `<head>
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="shortcut icon" href="/old.ico">
      <link rel="icon" type="image/svg+xml" href="//cdn.example.com/i.svg">
      <link rel="icon" href="data:image/png;base64,AAAA">
    </head>`;
    expect(extractMeta(html, PAGE).faviconCandidates).toEqual([
      "https://cdn.example.com/i.svg",
      "https://www.example.com/old.ico",
      "https://www.example.com/apple.png",
      "https://www.example.com/favicon.ico",
    ]);
  });

  it("resolves relative icons against the final page URL and dedupes the fallback", () => {
    const html = `<head><link rel=icon href="favicon.ico"></head>`;
    expect(extractMeta(html, "https://example.com/").faviconCandidates).toEqual(["https://example.com/favicon.ico"]);
  });
});

describe("iconExtension", () => {
  it("maps allowed image types and rejects others", () => {
    expect(iconExtension("image/png")).toBe("png");
    expect(iconExtension("image/x-icon")).toBe("ico");
    expect(iconExtension("image/vnd.microsoft.icon")).toBe("ico");
    expect(iconExtension("image/svg+xml; charset=utf-8")).toBe("svg");
    expect(iconExtension("image/jpeg")).toBe("jpg");
    expect(iconExtension("text/html")).toBeNull();
    expect(iconExtension("")).toBeNull();
  });
});

describe("extractMeta control characters", () => {
  it("strips NUL and other control characters Postgres text would reject", () => {
    const html = "<head><title>Bad\u0000Title\u0007!</title><meta name=description content=\"a\u0001b\"></head>";
    expect(extractMeta(html, PAGE)).toMatchObject({ title: "BadTitle!", description: "ab" });
  });
});

describe("quote-aware tags and MIME normalisation", () => {
  it("keeps attribute values that contain '>'", () => {
    const html = `<head><meta name="description" content="A -> B > C"><title>t</title></head>`;
    expect(extractMeta(html, PAGE).description).toBe("A -> B > C");
  });

  it("normalises favicon MIME types to lowercase without parameters", () => {
    expect(normalizeMime("Image/PNG; charset=binary")).toBe("image/png");
    expect(normalizeMime("")).toBe("");
  });
});

describe("extractMeta on hostile input", () => {
  // a crafted <head> full of tags that never close used to take time quadratic in
  // its size (~100 s at the 512 KB cap); a linear scan stays in milliseconds
  for (const unit of ["<title>", "<meta ", "<link ", '<meta "']) {
    it(`stays fast on 512 KB of unclosed ${JSON.stringify(unit)}`, () => {
      const html = "<head>" + unit.repeat(Math.floor((512 * 1024) / unit.length));
      const started = performance.now();
      expect(extractMeta(html, PAGE)).toMatchObject({ title: null, description: null });
      expect(performance.now() - started).toBeLessThan(500);
    });
  }

  it("still reads tags that come before a broken one", () => {
    const html = `<head><title>T</title><meta name="description" content="D"><link rel="icon" href="/i.png"><meta content="x`;
    expect(extractMeta(html, PAGE)).toMatchObject({
      title: "T",
      description: "D",
      faviconCandidates: ["https://www.example.com/i.png", "https://www.example.com/favicon.ico"],
    });
  });
});
