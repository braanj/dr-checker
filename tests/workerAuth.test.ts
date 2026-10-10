import { describe, it, expect } from "vitest";
import { checkWorkerSecret } from "../supabase/functions/process-queue/auth";

const SECRET = "a".repeat(64);

describe("checkWorkerSecret", () => {
  it("accepts an exact match", () => {
    expect(checkWorkerSecret(SECRET, SECRET)).toEqual({ ok: true });
  });

  it("rejects a missing or wrong header with 401", () => {
    const unauthorized = { ok: false, status: 401, error: "unauthorized" };
    expect(checkWorkerSecret(null, SECRET)).toEqual(unauthorized);
    expect(checkWorkerSecret("", SECRET)).toEqual(unauthorized);
    expect(checkWorkerSecret("b".repeat(64), SECRET)).toEqual(unauthorized);
  });

  it("rejects near-misses: other length, whitespace, case", () => {
    expect(checkWorkerSecret(SECRET.slice(1), SECRET)).toMatchObject({ status: 401 });
    expect(checkWorkerSecret(SECRET + "a", SECRET)).toMatchObject({ status: 401 });
    expect(checkWorkerSecret(` ${SECRET} `, SECRET)).toMatchObject({ status: 401 });
    expect(checkWorkerSecret(SECRET.toUpperCase(), SECRET)).toMatchObject({ status: 401 });
  });

  it("returns 500 when the worker secret is not configured, whatever the header", () => {
    const notConfigured = { ok: false, status: 500, error: "worker not configured" };
    expect(checkWorkerSecret(SECRET, undefined)).toEqual(notConfigured);
    expect(checkWorkerSecret("", "")).toEqual(notConfigured);
  });
});
