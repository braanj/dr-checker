import { describe, it, expect, vi, beforeEach } from "vitest";

// Fake service-role client: records calls, fails the urls insert on demand.
const calls: string[] = [];
let failUrlInsert = false;

function fakeClient() {
  return {
    from(table: string) {
      return {
        select: () => ({ in: async () => ({ data: [], error: null }) }),
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
vi.stubGlobal("createError", (opts: { statusMessage: string }) => new Error(opts.statusMessage));

const { createCheck } = await import("../server/utils/createCheck");

const rows = [{ original_url: "a.com", domain: "a.com" }];

describe("createCheck", () => {
  beforeEach(() => {
    calls.length = 0;
    failUrlInsert = false;
  });

  it("deletes the batch when inserting its url rows fails, so no orphan is left", async () => {
    failUrlInsert = true;
    await expect(createCheck({ rows, skipped: 0, label: "Quick check", source: "typed" })).rejects.toThrow(
      "Failed to insert URLs: boom",
    );
    expect(calls).toContain("delete:batches:id=batch-1");
  });

  it("keeps the batch when every insert succeeds", async () => {
    const res = await createCheck({ rows, skipped: 0, label: "Quick check", source: "typed" });
    expect(res).toMatchObject({ batchId: "batch-1", total: 1, queued: 1, display: "inline" });
    expect(calls.some((c) => c.startsWith("delete:"))).toBe(false);
  });
});
