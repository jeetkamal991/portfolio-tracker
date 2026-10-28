import type { AssistantEvent } from "@/lib/assistant/stream";
import type { AssistantMessage } from "@/lib/db/types";

export type AssistantTurn = Extract<AssistantMessage, { role: "assistant" }>;

export const emptyTurn = (): AssistantTurn => ({ role: "assistant", steps: [], text: "", usage: null, reports: [] });

/** Folds one stream event into an assistant turn; shared by the route (to save the chat) and the page (to draw it). */
export function applyEvent(turn: AssistantTurn, e: AssistantEvent): AssistantTurn {
  switch (e.type) {
    case "text":
      return { ...turn, text: turn.text + e.delta };
    case "step_start":
      return { ...turn, steps: [...turn.steps, { id: e.id, name: e.name, summary: e.summary, ok: true, output: "" }] };
    case "step_end":
      return { ...turn, steps: turn.steps.map((s) => (s.id === e.id ? { ...s, ok: e.ok, output: e.output } : s)) };
    case "done":
      return { ...turn, usage: { inputTokens: e.inputTokens, outputTokens: e.outputTokens, costUsd: e.costUsd }, reports: e.reports };
    case "error":
      return { ...turn, error: e.message };
  }
}

/** A short human label for one tool call, from the tool name and the summary the stream carries. */
export function stepLabel(name: string, summary: string): string {
  if (name === "WebSearch") return `Searched the web: ${summary}`;
  if (name === "WebFetch") return `Fetched ${summary}`;
  if (name !== "Bash") return name;
  const t = /npm run tracker -- (\w+)\s*(.*)/.exec(summary);
  if (t) {
    const arg = t[2].trim();
    switch (t[1]) {
      case "stock": return `Pulled ${arg.toUpperCase()} indicators`;
      case "find": return `Looked up “${arg}”`;
      case "screeners": return "Read today's screeners";
      case "alphas": return "Read the alpha rankings";
      case "market": return "Read the market overview";
      case "portfolio": return "Read your holdings";
    }
  }
  if (summary.includes("npm run backtest")) return "Ran a backtest";
  return summary;
}

export function fmtCost(usd: number): string {
  if (usd > 0 && usd < 0.005) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/** Empty-state chips: they only fill the box with an editable example. */
export const STARTERS: { label: string; text: string; holdings: boolean }[] = [
  { label: "Research a stock", text: "Research RELIANCE: how is it trading, what do the screeners and alphas say, and any recent news?", holdings: false },
  { label: "Test a strategy", text: "Backtest the top 10 stocks by alpha a101 over the last two years and compare it with Nifty 50.", holdings: false },
  { label: "Review my holdings", text: "Review my holdings: what is working, what is not, and what needs attention?", holdings: true },
];

/** Splits a server-sent-event buffer into whole frames; the unfinished tail is returned to be prefixed to the next chunk. */
export function splitSse(buf: string): { events: { type: string; data: unknown }[]; rest: string } {
  const parts = buf.split("\n\n");
  const rest = parts.pop() ?? "";
  const events = parts.flatMap((f) => {
    const type = /^event: (.*)$/m.exec(f)?.[1];
    const data = /^data: (.*)$/m.exec(f)?.[1];
    if (!type || data === undefined) return [];
    try {
      return [{ type, data: JSON.parse(data) as unknown }];
    } catch {
      return [];
    }
  });
  return { events, rest };
}
