export type SendResult = "sent" | `failed: ${string}` | "not_configured";
export type Sender = (text: string) => Promise<SendResult>;

const REASON_MAX = 200;

const failed = (reason: string): SendResult => `failed: ${reason}`.slice(0, REASON_MAX) as SendResult;

/**
 * Sends one message to the owner's chat through their own bot. Never throws: a missing token or chat id
 * is `not_configured` (no request), anything else that goes wrong is `failed: <reason>`.
 */
export function createTelegramSender(env: { token?: string; chatId?: string }, fetchImpl: typeof fetch = fetch, timeoutMs = 5000): Sender {
  return async (text) => {
    if (!env.token || !env.chatId) return "not_configured";
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${env.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
      if (res.ok && body?.ok) return "sent";
      return failed(body?.description ?? `HTTP ${res.status}`);
    } catch (e) {
      return failed(e instanceof Error ? e.message : String(e));
    }
  };
}
