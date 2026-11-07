import { describe, it, expect } from "vitest";
import { noteSubmitted, track, trackCompleted } from "../utils/track";

describe("track", () => {
  it("pushes the event and its payload onto dataLayer, creating it", () => {
    const target: { dataLayer?: unknown[] } = {};
    track("check_submitted", { source: "csv", rows: 40 }, target);
    expect(target.dataLayer).toEqual([{ event: "check_submitted", source: "csv", rows: 40 }]);
  });

  it("appends to an existing dataLayer", () => {
    const target = { dataLayer: [{ event: "gtm.js" }] as unknown[] };
    track("directory_export", { count: 3 }, target);
    expect(target.dataLayer).toEqual([{ event: "gtm.js" }, { event: "directory_export", count: 3 }]);
  });

  it("never throws when dataLayer.push throws", () => {
    const target = {
      dataLayer: {
        push() {
          throw new Error("blocked");
        },
      },
    };
    expect(() => track("results_csv_download", { rows: 1 }, target as never)).not.toThrow();
  });
});

describe("trackCompleted", () => {
  it("tracks check_completed once for a batch this tab submitted", () => {
    const target: { dataLayer?: unknown[] } = {};
    noteSubmitted("batch-a", 12, 1_000);
    trackCompleted("batch-a", "completed", 4_250, target);
    trackCompleted("batch-a", "completed", 9_000, target);
    expect(target.dataLayer).toEqual([{ event: "check_completed", status: "completed", rows: 12, seconds: 3.3 }]);
  });

  it("tells a check where every row failed apart from a finished one", () => {
    const target: { dataLayer?: unknown[] } = {};
    noteSubmitted("batch-f", 2, 0);
    trackCompleted("batch-f", "failed", 1_000, target);
    expect(target.dataLayer).toEqual([{ event: "check_completed", status: "failed", rows: 2, seconds: 1 }]);
  });

  it("tracks nothing for a batch this tab never submitted", () => {
    const target: { dataLayer?: unknown[] } = {};
    trackCompleted("batch-unknown", "completed", 5_000, target);
    expect(target.dataLayer).toBeUndefined();
  });
});
