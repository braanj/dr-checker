// Pure helpers for the /domains page: DR bands, deltas, paging and URL state.
import type { SortBy } from "~/server/utils/domainsQuery";

export type DrBand = "low" | "mid" | "high" | "top";

export function drBand(dr: number): DrBand {
  if (dr >= 80) return "top";
  if (dr >= 60) return "high";
  if (dr >= 30) return "mid";
  return "low";
}

export function formatDelta(change: number | null): {
  text: string;
  dir: "up" | "down" | "flat" | "none";
  label: string;
} {
  if (change === null || !Number.isFinite(change)) return { text: "—", dir: "none", label: "No previous check" };
  const n = Math.round(change);
  if (n > 0) return { text: `+${n}`, dir: "up", label: `Up ${n} since previous check` };
  if (n < 0) return { text: `−${-n}`, dir: "down", label: `Down ${-n} since previous check` };
  return { text: "0", dir: "flat", label: "No change since previous check" };
}

export function pageRange(current: number, total: number): (number | "…")[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current === 1) keep.add(3);
  if (current === total) keep.add(total - 2);
  const pages = [...keep].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  pages.forEach((p, i) => {
    if (i > 0) {
      const prev = pages[i - 1];
      if (p - prev === 2) out.push(prev + 1);
      else if (p - prev > 2) out.push("…");
    }
    out.push(p);
  });
  return out;
}

export interface DomainsState {
  page: number;
  pageSize: 20 | 50 | 100;
  sortBy: SortBy;
  sortDir: "asc" | "desc";
  domain: string;
  tld: string;
  drMin: string;
  drMax: string;
  checkedFrom: string;
  checkedTo: string;
}

export const DEFAULT_STATE: DomainsState = {
  page: 1,
  pageSize: 20,
  sortBy: "checked_at",
  sortDir: "desc",
  domain: "",
  tld: "",
  drMin: "",
  drMax: "",
  checkedFrom: "",
  checkedTo: "",
};

const MAX_PAGE = 100000;
const SORTS: readonly string[] = ["checked_at", "domain", "dr", "dr_change"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown): string {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" ? x.trim() : "";
}

function dr(v: unknown): string {
  const s = str(v);
  if (!/^\d{1,3}$/.test(s)) return "";
  return Number(s) <= 100 ? String(Number(s)) : "";
}

function date(v: unknown): string {
  const s = str(v);
  return DATE_RE.test(s) && !Number.isNaN(Date.parse(s)) ? s : "";
}

export function parseDomainsRoute(q: Record<string, unknown>): DomainsState {
  const rawPage = Number(str(q.page));
  const page = /^\d+$/.test(str(q.page)) && rawPage >= 1 && rawPage <= MAX_PAGE ? rawPage : 1;
  const size = Number(str(q.pageSize));
  const sortBy = str(q.sortBy);
  const sortDir = str(q.sortDir);
  return {
    page,
    pageSize: size === 50 || size === 100 ? size : 20,
    sortBy: SORTS.includes(sortBy) ? (sortBy as SortBy) : DEFAULT_STATE.sortBy,
    sortDir: sortDir === "asc" || sortDir === "desc" ? sortDir : DEFAULT_STATE.sortDir,
    domain: str(q.domain),
    tld: str(q.tld).replace(/^\.+/, "").toLowerCase(),
    drMin: dr(q.drMin),
    drMax: dr(q.drMax),
    checkedFrom: date(q.checkedFrom),
    checkedTo: date(q.checkedTo),
  };
}

export function toRouteQuery(s: DomainsState): Record<string, string> {
  const out: Record<string, string> = {};
  if (s.page !== DEFAULT_STATE.page) out.page = String(s.page);
  if (s.pageSize !== DEFAULT_STATE.pageSize) out.pageSize = String(s.pageSize);
  if (s.sortBy !== DEFAULT_STATE.sortBy) out.sortBy = s.sortBy;
  if (s.sortDir !== DEFAULT_STATE.sortDir) out.sortDir = s.sortDir;
  for (const k of ["domain", "tld", "drMin", "drMax", "checkedFrom", "checkedTo"] as const) {
    if (s[k]) out[k] = s[k];
  }
  return out;
}

export function nextSort(s: DomainsState, col: SortBy): Pick<DomainsState, "sortBy" | "sortDir" | "page"> {
  if (s.sortBy === col) return { sortBy: col, sortDir: s.sortDir === "asc" ? "desc" : "asc", page: 1 };
  return { sortBy: col, sortDir: col === "domain" ? "asc" : "desc", page: 1 };
}
