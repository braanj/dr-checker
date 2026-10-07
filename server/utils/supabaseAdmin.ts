// Service-role client for server routes only. Bypasses RLS — every read and
// write of batches/urls/domains goes through it, since those tables have no
// anon policies. NEVER import this in client code.

import { createClient } from "@supabase/supabase-js";
import { useRuntimeConfig } from "#imports";

let cached: ReturnType<typeof createClient> | null = null;

export function supabaseAdmin() {
  if (cached) return cached;

  const config = useRuntimeConfig();
  cached = createClient(config.public.supabaseUrl as string, config.supabaseServiceRoleKey as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
