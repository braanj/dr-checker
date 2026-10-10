import { describe, it, expect } from "vitest";
import { retryInfo } from "../utils/retry";

describe("retryInfo", () => {
  it("is null for a fresh pending row that was never tried", () => {
    expect(retryInfo({ status: "pending", attempts: 0 })).toBeNull();
  });

  it("names the next attempt for a pending row that already failed", () => {
    expect(retryInfo({ status: "pending", attempts: 1 })).toEqual({ attempt: 2, of: 3 });
    expect(retryInfo({ status: "pending", attempts: 2 })).toEqual({ attempt: 3, of: 3 });
  });

  it("is null while a row is being processed or once it is finished", () => {
    for (const status of ["processing", "done", "error"] as const) {
      expect(retryInfo({ status, attempts: 2 })).toBeNull();
    }
  });
});
