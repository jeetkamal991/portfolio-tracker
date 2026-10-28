import { describe, expect, it } from "vitest";
import { applyEvent, emptyTurn } from "@/lib/view/assistant";

describe("applyEvent", () => {
  it("accumulates text and pairs steps", () => {
    let t = emptyTurn();
    t = applyEvent(t, { type: "text", delta: "Hel" });
    t = applyEvent(t, { type: "text", delta: "lo" });
    t = applyEvent(t, { type: "step_start", id: "a", name: "Bash", summary: "npm run tracker -- market" });
    t = applyEvent(t, { type: "step_end", id: "a", ok: false, output: "boom" });
    expect(t.text).toBe("Hello");
    expect(t.steps).toEqual([{ id: "a", name: "Bash", summary: "npm run tracker -- market", ok: false, output: "boom" }]);
  });

  it("done sets usage and reports; error sets the message; input is not mutated", () => {
    const t0 = emptyTurn();
    const t1 = applyEvent(t0, { type: "done", inputTokens: 5, outputTokens: 6, costUsd: 0.2, turns: 2, durationMs: 1, denials: 0, reports: [3], cliSessionId: "s" });
    expect(t1.usage).toEqual({ inputTokens: 5, outputTokens: 6, costUsd: 0.2 });
    expect(t1.reports).toEqual([3]);
    expect(t0.usage).toBeNull();
    expect(applyEvent(t0, { type: "error", message: "x" }).error).toBe("x");
  });
});
