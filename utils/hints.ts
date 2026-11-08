// Hover text for terms that are not self-explanatory, kept in one place so every page says the same thing.
export const HINTS = {
  dr: "Domain Rating: Ahrefs' 0–100 score of how strong a site's backlink profile is",
  change: "Change in DR since the previous check",
  trend: "DR across the latest checks",
  checked: "When the DR was last checked",
  nextRecheck: "Each DR is re-checked automatically every 30 days",
  selectAll: "Select every domain on this page",
} as const;

export const STATUS_HINTS: Record<string, string> = {
  pending: "Waiting in the queue",
  processing: "Being checked with Ahrefs now",
  done: "Checked",
  error: "Could not be checked",
};
