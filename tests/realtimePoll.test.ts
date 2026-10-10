import { describe, it, expect } from "vitest";
import { shouldPoll, POLL_SILENCE_MS } from "../utils/realtimePoll";

const base = { channelFailed: false, lastBroadcastAt: 1_000_000, now: 1_000_000 };

describe("shouldPoll", () => {
  it("never polls a finished batch", () => {
    for (const status of ["completed", "failed"]) {
      expect(shouldPoll({ ...base, status, channelFailed: true, now: base.now + 60_000 })).toBe(false);
    }
  });

  it("polls an unfinished batch when the channel failed", () => {
    expect(shouldPoll({ ...base, status: "processing", channelFailed: true })).toBe(true);
  });

  it("polls an unfinished batch after a silence, not while broadcasts keep arriving", () => {
    expect(shouldPoll({ ...base, status: "pending", now: base.now + POLL_SILENCE_MS - 1 })).toBe(false);
    expect(shouldPoll({ ...base, status: "pending", now: base.now + POLL_SILENCE_MS })).toBe(true);
  });

  it("polls while the batch status is not known yet only after the silence", () => {
    expect(shouldPoll({ ...base, status: undefined, now: base.now + POLL_SILENCE_MS })).toBe(true);
  });
});
