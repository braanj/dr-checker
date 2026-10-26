export const RECENT_KEY = "dr-recent-checks";
export const RECENT_MAX = 20;

export interface RecentCheck {
  batchId: string;
  createdAt: string;
  total: number;
  label: string;
  inline: boolean;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isRecent(v: unknown): v is RecentCheck {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.batchId === "string" &&
    typeof o.createdAt === "string" &&
    typeof o.total === "number" &&
    typeof o.label === "string" &&
    typeof o.inline === "boolean"
  );
}

export function readRecent(storage: StorageLike | null): RecentCheck[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecent).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function writeRecent(storage: StorageLike | null, list: RecentCheck[]): void {
  if (!storage) return;
  try {
    storage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // storage unavailable or full: recent checks are a convenience only
  }
}

export function addRecent(list: RecentCheck[], entry: RecentCheck): RecentCheck[] {
  return [entry, ...list.filter((e) => e.batchId !== entry.batchId)].slice(0, RECENT_MAX);
}

export function recentLabel(input: { csvName?: string; typed?: string; total: number }): string {
  if (input.csvName) return input.csvName;
  const items = (input.typed ?? "").split(/[\s,;]+/).filter(Boolean);
  if (items.length === 0) return `${input.total} domains`;
  const rest = items.length - 1;
  return rest > 0 ? `${items[0]} +${rest} more` : items[0];
}

export function recentHref(entry: RecentCheck): string {
  return entry.inline ? `/?check=${entry.batchId}` : `/results/${entry.batchId}`;
}
