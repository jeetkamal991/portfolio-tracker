import { describe, it, expect, vi } from "vitest";
import { createTelegramSender } from "@/lib/notify/telegram";

const env = { token: "123:abc", chatId: "42" };
const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

describe("createTelegramSender", () => {
  it("posts the message to the bot's sendMessage and reports sent", async () => {
    const fetchImpl = vi.fn(reply(200, { ok: true }));
    expect(await createTelegramSender(env, fetchImpl)("🔔 hello")).toBe("sent");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ chat_id: "42", text: "🔔 hello", disable_web_page_preview: true });
  });
  it("reports Telegram's description when ok is false", async () => {
    const send = createTelegramSender(env, reply(400, { ok: false, description: "Bad Request: chat not found" }));
    expect(await send("x")).toBe("failed: Bad Request: chat not found");
  });
  it("reports the HTTP status when there is no description", async () => {
    expect(await createTelegramSender(env, reply(502, {}))("x")).toBe("failed: HTTP 502");
  });
  it("reports a network error without throwing", async () => {
    const send = createTelegramSender(env, async () => { throw new Error("getaddrinfo ENOTFOUND"); });
    expect(await send("x")).toBe("failed: getaddrinfo ENOTFOUND");
  });
  it("gives up after the timeout", async () => {
    const slow = (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    expect(await createTelegramSender(env, slow, 20)("x")).toMatch(/^failed: /);
  });
  it("caps the failure reason at 200 characters", async () => {
    const r = await createTelegramSender(env, reply(400, { ok: false, description: "x".repeat(500) }))("x");
    expect(r.length).toBe(200);
  });
  it("is not_configured without a token or chat id, and sends nothing", async () => {
    const fetchImpl = vi.fn(reply(200, { ok: true }));
    expect(await createTelegramSender({ chatId: "42" }, fetchImpl)("x")).toBe("not_configured");
    expect(await createTelegramSender({ token: "t", chatId: "" }, fetchImpl)("x")).toBe("not_configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
