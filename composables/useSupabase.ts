// Browser-side Supabase client (anon key only — safe to expose).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function useSupabase() {
  if (client) return client;
  const config = useRuntimeConfig();
  client = createClient(config.public.supabaseUrl as string, config.public.supabaseAnonKey as string);
  return client;
}
