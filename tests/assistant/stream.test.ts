import { describe, expect, it } from "vitest";
import { createStreamParser } from "@/lib/assistant/stream";

const L = (o: unknown) => JSON.stringify(o) + "\n";
const delta = (text: string) => L({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
const toolUse = (id: string, name: string, input: object) => L({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const toolResult = (id: string, content: unknown, is_error = false) => L({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error }] } });
const result = (extra: object = {}) =>
  L({ type: "result", subtype: "success", is_error: false, session_id: "s-1", total_cost_usd: 0.05, num_turns: 3, duration_ms: 1200, permission_denials: [{}, {}], usage: { input_tokens: 100, output_tokens: 40 }, ...extra });

describe("createStreamParser", () => {
  it("waits for the newline before emitting", () => {
    const p = createStreamParser();
    const line = delta("hi");
    expect(p.push(line.slice(0, 20))).toEqual([]);
    expect(p.push(line.slice(20))).toEqual([{ type: "text", delta: "hi" }]);
  });

  it("maps tool_use summaries by tool and pairs results", () => {
    const p = createStreamParser();
    const ev = p.push(
      toolUse("a", "Bash", { command: "npm run tracker -- stock RELIANCE" }) +
        toolUse("b", "WebSearch", { query: "reliance news" }) +
        toolUse("c", "WebFetch", { url: "https://x.test" }) +
        toolResult("a", [{ type: "text", text: "ok output" }]) +
        toolResult("b", "x".repeat(5000), true),
    );
    expect(ev.slice(0, 3)).toEqual([
      { type: "step_start", id: "a", name: "Bash", summary: "npm run tracker -- stock RELIANCE" },
      { type: "step_start", id: "b", name: "WebSearch", summary: "reliance news" },
      { type: "step_start", id: "c", name: "WebFetch", summary: "https://x.test" },
    ]);
    expect(ev[3]).toEqual({ type: "step_end", id: "a", ok: true, output: "ok output" });
    expect(ev[4]).toMatchObject({ type: "step_end", id: "b", ok: false });
    expect((ev[4] as { output: string }).output).toHaveLength(2000);
  });

  it("emits done with usage, denials, session id and saved report ids", () => {
    const p = createStreamParser();
    const ev = p.push(
      toolUse("a", "Bash", { command: "npm run backtest -- --alpha 1" }) +
        toolResult("a", "Metrics...\nSaved as run 7.") +
        toolUse("w", "WebSearch", { query: "q" }) +
        toolResult("w", "Saved as run 99") +
        result(),
    );
    expect(ev.at(-1)).toEqual({ type: "done", inputTokens: 100, outputTokens: 40, costUsd: 0.05, turns: 3, durationMs: 1200, denials: 2, reports: [7], cliSessionId: "s-1" });
  });

  it("skips blank and malformed lines; error results also emit error", () => {
    const p = createStreamParser();
    const ev = p.push("\nnot json\n{\"type\":\n" + delta("x") + result({ is_error: true, subtype: "error_max_budget_usd" }));
    expect(ev[0]).toEqual({ type: "text", delta: "x" });
    expect(ev.map((e) => e.type)).toEqual(["text", "error", "done"]);
  });

  it("end() flushes a last line with no newline", () => {
    const p = createStreamParser();
    expect(p.push(delta("a").trim())).toEqual([]);
    expect(p.end()).toEqual([{ type: "text", delta: "a" }]);
  });
});

it("finds 'Saved as run N' even past the 2,000-char excerpt", () => {
  const p = createStreamParser();
  const ev = p.push(toolUse("a", "Bash", { command: "npm run backtest -- x" }) + toolResult("a", [{ type: "text", text: "y".repeat(3000) + "\nSaved as run 12." }]) + result());
  expect(ev.at(-1)).toMatchObject({ reports: [12] });
});
