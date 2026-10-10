export function checkedAgo(iso: string, now: number = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

// Locale- and timezone-independent date for SSR + hydration (UTC).
export function isoDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}
