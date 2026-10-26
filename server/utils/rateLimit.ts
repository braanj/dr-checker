// Per-IP request limits, stored in Postgres because Nitro runs as short-lived
// Netlify functions (in-memory counters would reset). Each kind has its own bucket.

import type { H3Event } from "h3";
import { supabaseAdmin } from "./supabaseAdmin";

export type RateLimitKind = "check" | "export";

const REQUESTS_PER_MINUTE = 10;

const MESSAGES: Record<RateLimitKind, string> = {
  check: "Too many checks — try again in a minute",
  export: "Too many exports — try again in a minute",
};

function clientIp(event: H3Event): string {
  return (
    getRequestHeader(event, "x-nf-client-connection-ip") ??
    getRequestIP(event, { xForwardedFor: true }) ??
    "unknown"
  );
}

export async function assertRateLimit(event: H3Event, kind: RateLimitKind = "check") {
  const { data, error } = await supabaseAdmin().rpc("register_check_request", {
    p_ip: clientIp(event),
    p_limit: REQUESTS_PER_MINUTE,
    p_kind: kind,
  });

  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Rate limit check failed: ${error.message}` });
  }
  if (data !== true) {
    // The window is one minute, so 60 s is always enough.
    setResponseHeader(event, "Retry-After", 60);
    throw createError({ statusCode: 429, statusMessage: MESSAGES[kind] });
  }
}
