// SERVER ONLY. Route handlers run after middleware has authenticated the request, so they
// use the service-role repo. The quote cache is a module-level singleton: one per server
// instance (per Vercel lambda), which is acceptable for a single-user dashboard.
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { createQuoteCache } from "@/lib/live/quoteCache";
import { createTelegramSender } from "@/lib/notify/telegram";
import { createYahooProvider } from "@/lib/provider/yahoo";
import { createAdminClient } from "@/lib/supabase/admin";

export const getRepo = () => createSupabaseRepo(createAdminClient());

export const provider = createYahooProvider();
export const quoteCache = createQuoteCache((t) => provider.getQuotes(t));
/** Alert delivery; `not_configured` until TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set. */
export const telegram = createTelegramSender({ token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID });
export const telegramConfigured = () => !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID;
