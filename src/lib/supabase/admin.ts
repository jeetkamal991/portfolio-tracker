// SERVER / SCRIPT ONLY. Uses the service-role key, which bypasses RLS.
// Never import this from client components and never expose the key with a NEXT_PUBLIC prefix.
// (`import "server-only"` is deliberately omitted: it throws under tsx, and scripts import this file.)
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
