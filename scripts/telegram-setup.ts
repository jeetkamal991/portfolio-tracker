import { createTelegramSender } from "@/lib/notify/telegram";

/**
 * No TELEGRAM_CHAT_ID yet: lists the chats that have messaged the bot so you can copy the id.
 * Both set: sends a test message.
 */
async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // no .env.local: rely on the environment
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token) {
    console.log("Add TELEGRAM_BOT_TOKEN=<token from @BotFather> to .env.local, then run this again.");
    process.exit(1);
  }

  if (!chatId) {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: AbortSignal.timeout(10_000) });
    const body = (await res.json()) as {
      ok: boolean;
      description?: string;
      result?: { message?: { chat: { id: number; first_name?: string; username?: string; title?: string } } }[];
    };
    if (!body.ok) throw new Error(`getUpdates: ${body.description ?? `HTTP ${res.status}`}`);
    const chats = new Map<number, string>();
    for (const u of body.result ?? []) {
      const c = u.message?.chat;
      if (c) chats.set(c.id, c.title ?? c.first_name ?? c.username ?? "");
    }
    if (chats.size === 0) {
      console.log("Send any message to your bot first, then run this again.");
      return;
    }
    console.log("Chats that have messaged your bot:");
    for (const [id, name] of chats) console.log(`  ${id}  ${name}`);
    console.log("Copy your id into TELEGRAM_CHAT_ID= in .env.local, then run this again to send a test message.");
    return;
  }

  const result = await createTelegramSender({ token, chatId })("✅ Nifty Pulse alerts are connected");
  console.log(result === "sent" ? "Test message sent — check Telegram." : `Telegram: ${result}`);
  if (result !== "sent") process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
