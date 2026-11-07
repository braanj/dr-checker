import type { CheckResponse } from "~/server/utils/createCheck";
import { addRecent, readRecent, recentEntry, writeRecent } from "~/utils/recentChecks";
import { noteSubmitted, track } from "~/utils/track";

export type CheckInput = { source: "typed"; domains: string } | { source: "csv"; file: File };

export function recentStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

// Every check the browser starts goes through here, so tracking and
// "My recent checks" stay the same wherever the form lives. Errors propagate.
export async function submitCheck(input: CheckInput): Promise<CheckResponse> {
  let body: FormData | { domains: string };
  if (input.source === "typed") {
    body = { domains: input.domains };
  } else {
    body = new FormData();
    body.append("file", input.file);
  }
  const res = await $fetch<CheckResponse>("/api/check", { method: "POST", body });
  track("check_submitted", { source: input.source, rows: res.total });
  noteSubmitted(res.batchId, res.total);
  const storage = recentStorage();
  const label = input.source === "typed" ? { typed: input.domains } : { csvName: input.file.name };
  writeRecent(storage, addRecent(readRecent(storage), recentEntry(label, res, new Date().toISOString())));
  return res;
}
