import { describe, it, expect, vi, beforeEach } from "vitest";

// Fake service-role client: records calls, fails the urls insert on demand.
const calls: string[] = [];
let failUrlInsert = false;
let overBudget = false;
let cacheRows: unknown[] = [];

function fakeClient() {
  return {
    from(table: string) {
      return {
        select: () => ({ in: async () => ({ data: cacheRows, error: null }) }),
        insert: (rows: unknown) => {
          calls.push(`insert:${table}`);
          if (table === "batches") {
            return { select: () => ({ single: async () => ({ data: { id: "batch-1" }, error: null }) }) };
          }
          return Promise.resolve(
            failUrlInsert ? { error: { message: "boom" } } : { error: null },
          );
        },
        delete: () => ({
          eq: async (col: string, val: string) => {
            calls.push(`delete:${table}:${col}=${val}`);
            return { error: null };
          },
        }),
      };
    },
  };
}

vi.mock("../server/utils/supabaseAdmin", () => ({ supabaseAdmin: () => fakeClient() }));
vi.mock("../server/utils/rateLimit", () => ({
  assertRateLimit: async (_event: unknown, kind: string, weight: number) => {
    calls.push(`charge:${kind}:${weight}`);
    if (overBudget) throw new Error("Too many new domains");
  },
}));
vi.stubGlobal("createError", (opts: { statusMessage: string }) => new Error(opts.statusMessage));

const { createCheck } = await import("../server/utils/createCheck");

const event = {} as Parameters<typeof createCheck>[1];
const rows = [{ original_url: "a.com", domain: "a.com" }];
const twoRows = [...rows, { original_url: "b.com", domain: "b.com" }];
const input = (r = rows) => ({ rows: r, skipped: 0, label: "Quick check", source: "typed" as const });

describe("createCheck", () => {
  beforeEach(() => {
    calls.length = 0;
    failUrlInsert = false;
    overBudget = false;
    cacheRows = [];
  });

  it("deletes the batch when inserting its url rows fails, so no orphan is left", async () => {
    failUrlInsert = true;
    await expect(createCheck(input(), event)).rejects.toThrow("Failed to insert URLs: boom");
    expect(calls).toContain("delete:batches:id=batch-1");
  });

  it("keeps the batch when every insert succeeds", async () => {
    const res = await createCheck(input(), event);
    expect(res).toMatchObject({ batchId: "batch-1", total: 1, queued: 1, display: "inline" });
    expect(calls.some((c) => c.startsWith("delete:"))).toBe(false);
  });

  it("charges the IP's queue budget for uncached domains only, before inserting anything", async () => {
    cacheRows = [{ domain: "a.com", dr: 40, status: "ok", checked_at: new Date().toISOString() }];
    await createCheck(input(twoRows), event);
    expect(calls).toEqual(["charge:stored:2", "charge:rows:1", "insert:batches", "insert:urls"]);
  });

  it("charges the queue budget once per distinct uncached domain, since duplicates share one Ahrefs call", async () => {
    const dupes = [...twoRows, { original_url: "https://b.com/x", domain: "b.com" }];
    await createCheck(input(dupes), event);
    expect(calls).toContain("charge:rows:2");
    expect(calls).toContain("charge:stored:3");
  });

  it("charges only the storage budget when the cache fully answers the check", async () => {
    cacheRows = [{ domain: "a.com", dr: 40, status: "ok", checked_at: new Date().toISOString() }];
    await createCheck(input(), event);
    expect(calls.filter((c) => c.startsWith("charge:"))).toEqual(["charge:stored:1"]);
  });

  it("charges every stored row, cached duplicates included, before reading the cache", async () => {
    overBudget = true;
    const dupes = Array.from({ length: 3 }, () => ({ original_url: "a.com", domain: "a.com" }));
    await expect(createCheck(input(dupes), event)).rejects.toThrow("Too many new domains");
    expect(calls).toEqual(["charge:stored:3"]);
  });
});
