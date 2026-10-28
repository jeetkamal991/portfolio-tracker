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

import { STARTERS, fmtCost, stepLabel } from "@/lib/view/assistant";
import { TABS, activeTab } from "@/lib/view/shell";

describe("stepLabel", () => {
  it("describes each tool in plain words", () => {
    expect(stepLabel("Bash", "npm run tracker -- stock RELIANCE")).toBe("Pulled RELIANCE indicators");
    expect(stepLabel("Bash", "npm run tracker -- find reliance")).toBe("Looked up “reliance”");
    expect(stepLabel("Bash", "npm run tracker -- screeners")).toBe("Read today's screeners");
    expect(stepLabel("Bash", "npm run tracker -- alphas --alpha a101")).toBe("Read the alpha rankings");
    expect(stepLabel("Bash", "npm run tracker -- market")).toBe("Read the market overview");
    expect(stepLabel("Bash", "npm run tracker -- portfolio")).toBe("Read your holdings");
    expect(stepLabel("Bash", "npm run backtest -- alpha --alpha a101")).toBe("Ran a backtest");
    expect(stepLabel("WebSearch", "reliance news")).toBe("Searched the web: reliance news");
    expect(stepLabel("WebFetch", "https://x.test/a")).toBe("Fetched https://x.test/a");
    expect(stepLabel("Other", "zzz")).toBe("Other");
  });
});

describe("helpers", () => {
  it("fmtCost", () => {
    expect(fmtCost(0)).toBe("$0.00");
    expect(fmtCost(0.0049)).toBe("<$0.01");
    expect(fmtCost(0.456)).toBe("$0.46");
  });
  it("starters: only the holdings one switches holdings on", () => {
    expect(STARTERS.map((s) => [s.label, s.holdings])).toEqual([["Research a stock", false], ["Test a strategy", false], ["Review my holdings", true]]);
  });
  it("tabs carry the assistant and the renamed reports", () => {
    expect(TABS.map((t) => t.label)).toEqual(["Dashboard", "Portfolio", "Watchlist", "Sector Analysis", "Market", "Research assistant", "Backtest reports", "Alerts"]);
    expect(activeTab("/assistant")).toBe("/assistant");
  });
});

import { splitSse } from "@/lib/view/assistant";

describe("splitSse", () => {
  it("returns whole frames and keeps the partial tail", () => {
    const a = splitSse('event: text\ndata: {"type":"text","delta":"a"}\n\nevent: do');
    expect(a.events).toEqual([{ type: "text", data: { type: "text", delta: "a" } }]);
    expect(a.rest).toBe("event: do");
    const b = splitSse(a.rest + 'ne\ndata: {"x":1}\n\n');
    expect(b.events).toEqual([{ type: "done", data: { x: 1 } }]);
    expect(b.rest).toBe("");
  });
  it("skips frames that are not valid JSON", () => {
    expect(splitSse("event: text\ndata: {oops\n\n").events).toEqual([]);
  });
});
