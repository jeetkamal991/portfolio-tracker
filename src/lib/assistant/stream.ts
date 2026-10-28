export type AssistantEvent =
  | { type: "text"; delta: string }
  | { type: "step_start"; id: string; name: string; summary: string }
  | { type: "step_end"; id: string; ok: boolean; output: string }
  | { type: "done"; inputTokens: number; outputTokens: number; costUsd: number; turns: number; durationMs: number; denials: number; reports: number[]; cliSessionId: string | null }
  | { type: "error"; message: string };

const MAX_OUTPUT = 2000;

/* eslint-disable @typescript-eslint/no-explicit-any */
function summary(name: string, input: any): string {
  const v = name === "Bash" ? input?.command : name === "WebSearch" ? input?.query : name === "WebFetch" ? input?.url : null;
  return typeof v === "string" ? v : JSON.stringify(input ?? {});
}

function fullText(content: any): string {
  return typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (typeof c?.text === "string" ? c.text : "")).join("") : "";
}

/** Turns the CLI's newline-delimited stream-json into UI events. Chunks may split lines anywhere. */
export function createStreamParser() {
  let buf = "";
  const open = new Map<string, string>(); // tool_use id -> tool name
  const reports: number[] = [];

  function parseLine(line: string): AssistantEvent[] {
    if (!line.trim()) return [];
    let m: any;
    try {
      m = JSON.parse(line);
    } catch {
      return [];
    }
    const out: AssistantEvent[] = [];
    if (m.type === "stream_event") {
      const d = m.event?.delta;
      if (m.event?.type === "content_block_delta" && d?.type === "text_delta" && typeof d.text === "string") out.push({ type: "text", delta: d.text });
    } else if (m.type === "assistant") {
      for (const b of m.message?.content ?? []) {
        if (b?.type === "tool_use" && !open.has(b.id)) {
          open.set(b.id, b.name);
          out.push({ type: "step_start", id: b.id, name: b.name, summary: summary(b.name, b.input) });
        }
      }
    } else if (m.type === "user") {
      for (const b of m.message?.content ?? []) {
        if (b?.type !== "tool_result" || !open.has(b.tool_use_id)) continue;
        const full = fullText(b.content);
        if (open.get(b.tool_use_id) === "Bash") {
          const hit = /Saved as run (\d+)/.exec(full);
          if (hit) reports.push(Number(hit[1]));
        }
        out.push({ type: "step_end", id: b.tool_use_id, ok: !b.is_error, output: full.slice(0, MAX_OUTPUT) });
      }
    } else if (m.type === "result") {
      if (m.is_error) out.push({ type: "error", message: typeof m.result === "string" && m.result ? m.result : String(m.subtype ?? "The run failed") });
      out.push({
        type: "done",
        inputTokens: m.usage?.input_tokens ?? 0,
        outputTokens: m.usage?.output_tokens ?? 0,
        costUsd: m.total_cost_usd ?? 0,
        turns: m.num_turns ?? 0,
        durationMs: m.duration_ms ?? 0,
        denials: Array.isArray(m.permission_denials) ? m.permission_denials.length : 0,
        reports: [...reports],
        cliSessionId: typeof m.session_id === "string" ? m.session_id : null,
      });
    }
    return out;
  }

  return {
    push(chunk: string): AssistantEvent[] {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      return lines.flatMap(parseLine);
    },
    end(): AssistantEvent[] {
      const rest = buf;
      buf = "";
      return parseLine(rest);
    },
  };
}
