export type NavSection = "check" | "domains" | "docs";

/** localStorage key; value "collapsed" or absent. Mirrored on <html data-sidebar>. */
export const SIDEBAR_KEY = "dr-sidebar";

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** Which sidebar entry a route belongs to. Pass `route.path` (no query). */
export function navSection(path: string): NavSection | null {
  if (path === "/" || under(path, "/results")) return "check";
  if (under(path, "/domains") || under(path, "/domain")) return "domains";
  if (under(path, "/docs")) return "docs";
  return null;
}
