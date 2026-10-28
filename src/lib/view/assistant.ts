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
