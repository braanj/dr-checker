import { describe, it, expect, vi, beforeEach } from "vitest";

let allowed = true;
const headers: Record<string, string> = {};

vi.mock("../server/utils/supabaseAdmin", () => ({
  supabaseAdmin: () => ({ rpc: async () => ({ data: allowed, error: null }) }),
}));
vi.stubGlobal("getRequestHeader", () => "203.0.113.7");
vi.stubGlobal("getRequestIP", () => undefined);
vi.stubGlobal("setResponseHeader", (_e: unknown, name: string, value: string) => {
  headers[name] = String(value);
});
vi.stubGlobal("createError", (o: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(o.statusMessage), { statusCode: o.statusCode }),
);

const { assertRateLimit } = await import("../server/utils/rateLimit");
const event = {} as Parameters<typeof assertRateLimit>[0];

describe("assertRateLimit", () => {
  beforeEach(() => {
    for (const k of Object.keys(headers)) delete headers[k];
  });

  it("throws 429 with Retry-After: 60 when the IP is over the limit", async () => {
    allowed = false;
    await expect(assertRateLimit(event)).rejects.toMatchObject({ statusCode: 429 });
    expect(headers["Retry-After"]).toBe("60");
  });

  it("sets no Retry-After when the request is allowed", async () => {
    allowed = true;
    await expect(assertRateLimit(event)).resolves.toBeUndefined();
    expect(headers["Retry-After"]).toBeUndefined();
  });
});
