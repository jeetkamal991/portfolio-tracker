// SERVER ONLY. Route handlers run after middleware has authenticated the request, so they
// use the service-role repo. The quote cache is a module-level singleton: one per server
// instance (per Vercel lambda), which is acceptable for a single-user dashboard.
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { createQuoteCache } from "@/lib/live/quoteCache";
import { createYahooProvider } from "@/lib/provider/yahoo";
import { createAdminClient } from "@/lib/supabase/admin";

export const getRepo = () => createSupabaseRepo(createAdminClient());

export const provider = createYahooProvider();
export const quoteCache = createQuoteCache((t) => provider.getQuotes(t));
