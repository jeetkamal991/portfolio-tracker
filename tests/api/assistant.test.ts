import { describe, expect, it } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import { handleAssistantRun, type AssistantDeps } from "@/lib/api/assistant";
import { BusyError } from "@/lib/assistant/runner";
import type { AssistantEvent } from "@/lib/assistant/stream";

type Run = AssistantDeps["run"];
const doneEv = (cli = "cli-1", reports: number[] = []): AssistantEvent => ({ type: "done", inputTokens: 1, outputTokens: 2, costUsd: 0.1, turns: 1, durationMs: 1, denials: 0, reports, cliSessionId: cli });

function deps(run: Run, over: Partial<AssistantDeps> = {}) {
  const repo = createMemoryRepo();
  const calls: string[][] = [];
  const d: AssistantDeps = {
    repo, env: {}, signal: new AbortController().signal, cwd: "/x", isBusy: () => false,
    run: async (o, on) => { calls.push(o.args); await run(o, on); },
    ...over,
  };
  return { d, repo, calls };
}
async function drain(r: Awaited<ReturnType<typeof handleAssistantRun>>) {
  if (!("stream" in r)) throw new Error("expected a stream");
  const text = await new Response(r.stream).text();
  return text.split("\n\n").filter(Boolean).map((f) => {
    const [ev, data] = f.split("\n");
    return { type: ev.replace("event: ", ""), data: JSON.parse(data.replace("data: ", "")) };
  });
}
const good: Run = async (_o, on) => {
  on({ type: "text", delta: "Hi" });
  on({ type: "step_start", id: "a", name: "Bash", summary: "npm run backtest" });
  on({ type: "step_end", id: "a", ok: true, output: "Saved as run 4" });
  on(doneEv("cli-1", [4]));
};

describe("handleAssistantRun", () => {
  it("501 on Vercel", async () => {
    const { d } = deps(good, { env: { VERCEL: "1" } });
    expect(await handleAssistantRun(d, { message: "hi" })).toEqual({ status: 501, body: { error: "The assistant runs only on your PC" } });
  });

  it.each([{}, { message: "" }, { message: "x".repeat(4001) }, { message: "hi", holdings: "yes" }, { message: "hi", sessionId: "a" }])("400 on %j", async (b) => {
    expect((await handleAssistantRun(deps(good).d, b)).hasOwnProperty("status")).toBe(true);
    expect(await handleAssistantRun(deps(good).d, b)).toMatchObject({ status: 400 });
  });

  it("409 when busy, 404 for an unknown session", async () => {
    expect(await handleAssistantRun(deps(good, { isBusy: () => true }).d, { message: "hi" })).toMatchObject({ status: 409 });
    expect(await handleAssistantRun(deps(good).d, { message: "hi", sessionId: 99 })).toMatchObject({ status: 404 });
  });

  it("streams events, then saves the chat with steps, usage, reports and the CLI session id", async () => {
    const { d, repo } = deps(good);
    const frames = await drain(await handleAssistantRun(d, { message: "y".repeat(100) }));
    expect(frames.map((f) => f.type)).toEqual(["session", "text", "step_start", "step_end", "done"]);
    const id = frames[0].data.id;
    const s = (await repo.getAssistantSession(id))!;
    expect(s.title).toBe("y".repeat(60));
    expect(s.cliSessionId).toBe("cli-1");
    expect(s.messages[0]).toEqual({ role: "user", text: "y".repeat(100) });
    expect(s.messages[1]).toMatchObject({ role: "assistant", text: "Hi", reports: [4], usage: { costUsd: 0.1 } });
  });

  it("resumes with the stored CLI session id", async () => {
    const { d, repo, calls } = deps(good);
    const id = await repo.createAssistantSession("t");
    await repo.updateAssistantSession(id, { cliSessionId: "old" });
    await drain(await handleAssistantRun(d, { message: "more", sessionId: id }));
    expect(calls[0][calls[0].indexOf("--resume") + 1]).toBe("old");
    expect((await repo.getAssistantSession(id))!.messages).toHaveLength(2);
  });

  it("a resume that fails before any output retries fresh and says so", async () => {
    let n = 0;
    const run: Run = async (o, on) => {
      n++;
      if (o.args.includes("--resume")) on({ type: "error", message: "No conversation found" });
      else await good(o, on);
    };
    const { d, repo, calls } = deps(run);
    const id = await repo.createAssistantSession("t");
    await repo.updateAssistantSession(id, { cliSessionId: "gone" });
    const frames = await drain(await handleAssistantRun(d, { message: "more", sessionId: id }));
    expect(n).toBe(2);
    expect(calls[1]).not.toContain("--resume");
    expect(frames.find((f) => f.type === "text")!.data.delta).toMatch(/fresh/);
    expect(frames.some((f) => f.type === "error")).toBe(false);
  });

  it("abort saves the partial text marked Stopped", async () => {
    const ac = new AbortController();
    const run: Run = async (_o, on) => { on({ type: "text", delta: "part" }); ac.abort(); };
    const { d, repo } = deps(run, { signal: ac.signal });
    const frames = await drain(await handleAssistantRun(d, { message: "hi" }));
    const s = (await repo.getAssistantSession(frames[0].data.id))!;
    expect(s.messages[1]).toMatchObject({ text: "part", error: "Stopped" });
  });

  it("a BusyError from the runner becomes an error frame", async () => {
    const run: Run = async () => { throw new BusyError(); };
    const frames = await drain(await handleAssistantRun(deps(run).d, { message: "hi" }));
    expect(frames.at(-1)!.type).toBe("error");
  });

  it("holdings mode never gets web tools, whatever else is sent", async () => {
    const { d, calls } = deps(good);
    await drain(await handleAssistantRun(d, { message: "hi", holdings: true, model: "claude-opus-5-5" }));
    expect(calls[0].join(" ")).not.toMatch(/WebSearch|WebFetch/);
    expect(calls[0]).toContain("claude-opus-5-5");
  });

  it("passes a message full of shell characters as one argument", async () => {
    const { d, calls } = deps(good);
    const m = "x; rm -rf / $(y) \"q\" --tools Bash\nline2";
    await drain(await handleAssistantRun(d, { message: m }));
    expect(calls[0][calls[0].indexOf("-p") + 1]).toBe(m);
  });
});
