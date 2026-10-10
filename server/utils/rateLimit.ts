// Per-IP limit for POST /api/check, stored in Postgres because Nitro runs
// as short-lived Netlify functions (in-memory counters would reset).

import type { H3Event } from "h3";
import { supabaseAdmin } from "./supabaseAdmin";

const REQUESTS_PER_MINUTE = 10;

function clientIp(event: H3Event): string {
  return (
    getRequestHeader(event, "x-nf-client-connection-ip") ??
    getRequestIP(event, { xForwardedFor: true }) ??
    "unknown"
  );
}

export async function assertRateLimit(event: H3Event) {
  const { data, error } = await supabaseAdmin().rpc("register_check_request", {
    p_ip: clientIp(event),
    p_limit: REQUESTS_PER_MINUTE,
  });

  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Rate limit check failed: ${error.message}` });
  }
  if (data !== true) {
    // The window is one minute, so 60 s is always enough.
    setResponseHeader(event, "Retry-After", 60);
    throw createError({ statusCode: 429, statusMessage: "Too many checks — try again in a minute" });
  }
}
