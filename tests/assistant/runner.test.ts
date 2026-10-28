import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { BusyError, cliEnv, resolveClaudeBin, runAssistant } from "@/lib/assistant/runner";
import type { AssistantEvent } from "@/lib/assistant/stream";

const fake = fileURLToPath(new URL("./fakeCli.mjs", import.meta.url));
const run = (mode: string, o: { signal?: AbortSignal; timeoutMs?: number; bin?: string } = {}) => {
  const events: AssistantEvent[] = [];
  const p = runAssistant({ args: [fake, mode], cwd: process.cwd(), bin: o.bin ?? process.execPath, signal: o.signal ?? new AbortController().signal, timeoutMs: o.timeoutMs ?? 10_000 }, (e) => events.push(e));
  return { events, p };
};

describe("runAssistant", () => {
  it("relays parsed events in order and ignores stderr noise", async () => {
    const { events, p } = run("ok");
    await p;
    expect(events.map((e) => e.type)).toEqual(["text", "text", "done"]);
  });

  it("rejects a second concurrent run with BusyError, then frees the lock", async () => {
    const a = run("slow", { timeoutMs: 300 });
    await expect(run("ok").p).rejects.toBeInstanceOf(BusyError);
    await a.p;
    const b = run("ok");
    await b.p;
    expect(b.events.at(-1)?.type).toBe("done");
  });

  it("abort kills the child and resolves with the partial text", async () => {
    const ac = new AbortController();
    const { events, p } = run("slow", { signal: ac.signal });
    setTimeout(() => ac.abort(), 400);
    await p;
    expect(events).toEqual([{ type: "text", delta: "partial" }]);
  });

  it("timeout kills the child and reports it", async () => {
    const { events, p } = run("slow", { timeoutMs: 400 });
    await p;
    expect(events.at(-1)).toEqual({ type: "error", message: "The run took too long and was stopped." });
  });

  it("a missing binary becomes an error event with the fix", async () => {
    const { events, p } = run("ok", { bin: "definitely-not-a-binary-xyz" });
    await p;
    expect(events[0]).toMatchObject({ type: "error" });
    expect((events[0] as { message: string }).message).toMatch(/claude login/);
  });

  it("a crash without a result reports the exit and the stderr tail", async () => {
    const { events, p } = run("crash");
    await p;
    expect((events.at(-1) as { message: string }).message).toMatch(/Not logged in/);
  });
});

describe("runAssistant environment", () => {
  it("switches the CLI's auto-memory off", async () => {
    const { events, p } = run("env");
    await p;
    expect(events[0]).toEqual({ type: "text", delta: "1" });
  });
});

describe("runAssistant output and secrets", () => {
  it("keeps a multi-byte character that is split across pipe chunks", async () => {
    const { events, p } = run("split");
    await p;
    expect(events[0]).toEqual({ type: "text", delta: "₹100" });
  });

  it("does not hand server secrets to the CLI", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "secret";
    try {
      const { events, p } = run("secrets");
      await p;
      expect(events[0]).toEqual({ type: "text", delta: "clean" });
    } finally {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
  });

  it("cliEnv keeps login/system variables and drops the rest", () => {
    const e = cliEnv({ PATH: "p", APPDATA: "a", USERPROFILE: "u", CLAUDE_BIN: "c", SUPABASE_SERVICE_ROLE_KEY: "s", TELEGRAM_BOT_TOKEN: "t" });
    expect(e).toMatchObject({ PATH: "p", APPDATA: "a", USERPROFILE: "u", CLAUDE_BIN: "c", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });
    expect(e).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    expect(e).not.toHaveProperty("TELEGRAM_BOT_TOKEN");
  });
});

describe("resolveClaudeBin", () => {
  it("prefers CLAUDE_BIN, else claude", () => {
    expect(resolveClaudeBin({ CLAUDE_BIN: "X:/c.exe" })).toBe("X:/c.exe");
    expect(resolveClaudeBin({ PATH: "" })).toBe("claude");
  });
});
