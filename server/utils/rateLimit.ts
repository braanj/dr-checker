// Per-IP limits, stored in Postgres because Nitro runs as short-lived Netlify
// functions (in-memory counters would reset). Each kind has its own bucket.

import type { H3Event } from "h3";
import { supabaseAdmin } from "./supabaseAdmin";

export type RateLimitKind = "check" | "export" | "rows";

const LIMITS: Record<RateLimitKind, { limit: number; windowSeconds: number; message: string }> = {
  check: { limit: 10, windowSeconds: 60, message: "Too many checks — try again in a minute" },
  export: { limit: 10, windowSeconds: 60, message: "Too many exports — try again in a minute" },
  // the worker clears about 8,000 uncached domains an hour; one IP gets a quarter of that
  rows: {
    limit: 2000,
    windowSeconds: 3600,
    message: "Too many new domains from your network this hour (2,000 max; domains already in the directory don't count). Try again later.",
  },
};

function clientIp(event: H3Event): string {
  return (
    getRequestHeader(event, "x-nf-client-connection-ip") ??
    getRequestIP(event, { xForwardedFor: true }) ??
    "unknown"
  );
}

// `weight` is what this request costs: 1, or the number of queued domains for "rows".
export async function assertRateLimit(event: H3Event, kind: RateLimitKind = "check", weight = 1) {
  const { limit, windowSeconds, message } = LIMITS[kind];
  const { data, error } = await supabaseAdmin().rpc("register_check_request", {
    p_ip: clientIp(event),
    p_limit: limit,
    p_kind: kind,
    p_weight: weight,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Rate limit check failed: ${error.message}` });
  }
  if (data !== true) {
    // the window is the longest anyone waits for capacity to free up
    setResponseHeader(event, "Retry-After", windowSeconds);
    throw createError({ statusCode: 429, statusMessage: message });
  }
}
