import { describe, it, expect, vi, beforeEach } from "vitest";

let allowed = true;
let lastArgs: Record<string, unknown> = {};
const headers: Record<string, string> = {};

vi.mock("../server/utils/supabaseAdmin", () => ({
  supabaseAdmin: () => ({
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      lastArgs = args;
      return { data: allowed, error: null };
    },
  }),
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

  it("sends p_kind 'check' by default", async () => {
    allowed = true;
    await assertRateLimit(event);
    expect(lastArgs).toEqual({ p_ip: "203.0.113.7", p_limit: 10, p_kind: "check" });
  });

  it("uses the export bucket and message", async () => {
    allowed = false;
    await expect(assertRateLimit(event, "export")).rejects.toMatchObject({
      statusCode: 429,
      message: "Too many exports — try again in a minute",
    });
    expect(lastArgs.p_kind).toBe("export");
  });
});
