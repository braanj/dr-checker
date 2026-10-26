import { EXPORT_MAX } from "../server/utils/domainsCsv";

export const SELECTION_KEY = "dr-domains-selection";

export function loadSelection(storage: Pick<Storage, "getItem"> | null): Set<string> {
  try {
    const raw = storage?.getItem(SELECTION_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set<string>();
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      if (out.size >= EXPORT_MAX) break;
      out.add(v);
    }
    return out;
  } catch {
    return new Set();
  }
}

export function saveSelection(storage: Pick<Storage, "setItem"> | null, sel: Set<string>): void {
  try {
    storage?.setItem(SELECTION_KEY, JSON.stringify([...sel]));
  } catch {
    // storage unavailable or full: selection simply isn't persisted
  }
}

export function toggleDomain(sel: Set<string>, domain: string): { sel: Set<string>; capped: boolean } {
  const next = new Set(sel);
  if (next.has(domain)) {
    next.delete(domain);
    return { sel: next, capped: false };
  }
  if (next.size >= EXPORT_MAX) return { sel: next, capped: true };
  next.add(domain);
  return { sel: next, capped: false };
}

export function setPage(sel: Set<string>, pageDomains: string[], on: boolean): { sel: Set<string>; capped: boolean } {
  const next = new Set(sel);
  if (!on) {
    for (const d of pageDomains) next.delete(d);
    return { sel: next, capped: false };
  }
  let capped = false;
  for (const d of pageDomains) {
    if (next.has(d)) continue;
    if (next.size >= EXPORT_MAX) {
      capped = true;
      break;
    }
    next.add(d);
  }
  return { sel: next, capped };
}

export function pageCheckState(sel: Set<string>, pageDomains: string[]): "none" | "some" | "all" {
  if (pageDomains.length === 0) return "none";
  const n = pageDomains.filter((d) => sel.has(d)).length;
  return n === 0 ? "none" : n === pageDomains.length ? "all" : "some";
}
