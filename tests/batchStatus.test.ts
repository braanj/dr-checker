import { describe, it, expect } from "vitest";
import { initialBatchStatus, type PlannedUrl } from "../server/utils/checkInput";

const row = (status: PlannedUrl["status"]): PlannedUrl => ({
  original_url: "a.com",
  domain: "a.com",
  status,
  dr: status === "done" ? 50 : null,
  source: status === "pending" ? null : status === "done" ? "cache" : "no_data",
  checked_at: null,
  error_message: null,
});

describe("initialBatchStatus", () => {
  it("is pending while any row still waits for the worker", () => {
    expect(initialBatchStatus([row("done"), row("pending")])).toBe("pending");
    expect(initialBatchStatus([row("error"), row("pending")])).toBe("pending");
  });

  it("is completed when the cache answered everything and at least one row has a DR", () => {
    expect(initialBatchStatus([row("done"), row("done")])).toBe("completed");
    expect(initialBatchStatus([row("done"), row("error")])).toBe("completed");
  });

  it("is failed when the cache answered everything and every row is an error", () => {
    expect(initialBatchStatus([row("error"), row("error")])).toBe("failed");
  });
});
