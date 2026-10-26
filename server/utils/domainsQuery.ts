// Pure query parsing and response types for GET /api/domains. No Nitro
// auto-imports here: the /domains page imports these types.

export const PAGE_SIZES = [20, 50, 100] as const;
export type SortBy = "checked_at" | "domain" | "dr" | "dr_change";

export interface DomainsQuery {
  page: number;
  pageSize: 20 | 50 | 100;
  sortBy: SortBy;
  sortDir: "asc" | "desc";
  domain: string;
  tld: string;
  drMin: number | null;
  drMax: number | null;
  checkedFrom: string | null;
  checkedTo: string | null;
}

export class DomainsQueryError extends Error {}

export interface DomainListRow {
  domain: string;
  dr: number | null;
  checked_at: string;
  dr_change: number | null;
  title: string | null;
  favicon_url: string | null;
  trend: number[];
}

export interface DomainsResponse {
  domains: DomainListRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const SORT_COLUMNS = new Set<string>(["checked_at", "domain", "dr", "dr_change"]);
const SORT_DIRS = new Set<string>(["asc", "desc"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseNumber(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

export function parseDomainsQuery(q: Record<string, unknown>): DomainsQuery {
  const page = Math.max(1, parseInt((q.page as string) ?? "1", 10) || 1);

  const rawSize = typeof q.pageSize === "string" ? q.pageSize.trim() : "20";
  const pageSize = Number(rawSize);
  if (!(PAGE_SIZES as readonly number[]).includes(pageSize)) {
    throw new DomainsQueryError(`Invalid pageSize: ${rawSize}`);
  }

  const sortBy = ((q.sortBy as string) ?? "checked_at").trim();
  if (!SORT_COLUMNS.has(sortBy)) throw new DomainsQueryError(`Invalid sortBy: ${sortBy}`);

  const sortDir = ((q.sortDir as string) ?? "desc").trim();
  if (!SORT_DIRS.has(sortDir)) throw new DomainsQueryError(`Invalid sortDir: ${sortDir}`);

  return {
    page,
    pageSize: pageSize as DomainsQuery["pageSize"],
    sortBy: sortBy as SortBy,
    sortDir: sortDir as "asc" | "desc",
    domain: typeof q.domain === "string" ? q.domain.trim() : "",
    tld: typeof q.tld === "string" ? q.tld.trim().replace(/^\.+/, "").toLowerCase() : "",
    drMin: parseNumber(q.drMin),
    drMax: parseNumber(q.drMax),
    checkedFrom: parseDate(q.checkedFrom),
    checkedTo: parseDate(q.checkedTo),
  };
}
