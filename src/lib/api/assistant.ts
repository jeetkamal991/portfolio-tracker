import { z } from "zod";
import { buildArgs } from "@/lib/assistant/args";
import { BusyError, type RunInput } from "@/lib/assistant/runner";
import type { AssistantEvent } from "@/lib/assistant/stream";
import type { Repo } from "@/lib/db/repo";
import { applyEvent, emptyTurn } from "@/lib/view/assistant";
import type { ApiResult } from "./levels";

const MAX_MESSAGE = 4000;
const body = z.object({
  sessionId: z.number().int().positive().optional(),
  message: z.string().trim().min(1).max(MAX_MESSAGE),
  holdings: z.boolean().default(false),
  model: z.string().regex(/^[\w.-]{1,64}$/).optional(),
});

export interface AssistantDeps {
  repo: Repo;
  run: (o: RunInput, onEvent: (e: AssistantEvent) => void) => Promise<void>;
  /** Takes the single run slot synchronously (before any await) so two requests cannot both pass. */
  acquire: () => (() => void) | null;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
  /** The assistant's working folder. */
  cwd: string;
}

const MODE_NOTE = "(Holdings and web research never share a conversation, so this starts fresh.)\n\n";
const RESUME_NOTE = "(I couldn't pick up the earlier conversation on this PC, so this starts fresh.)\n\n";

/** Validates, runs the CLI and returns either an error result or a server-sent-event stream. The chat is saved however the run ends. */
export async function handleAssistantRun(deps: AssistantDeps, raw: unknown): Promise<ApiResult | { stream: ReadableStream<Uint8Array> }> {
  const { repo, env } = deps;
  if (env.VERCEL) return { status: 501, body: { error: "The assistant runs only on your PC" } };
  const parsed = body.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: "invalid_body" } };
  const input = parsed.data;
  const release = deps.acquire();
  if (!release) return { status: 409, body: { error: "busy" } };

  let existing: Awaited<ReturnType<Repo["getAssistantSession"]>> = null;
  let sessionId: number;
  try {
    existing = input.sessionId ? await repo.getAssistantSession(input.sessionId) : null;
    if (input.sessionId && !existing) {
      release();
      return { status: 404, body: { error: "not_found" } };
    }
    sessionId = existing ? existing.id : await repo.createAssistantSession(input.message.slice(0, 60));
  } catch (e) {
    release();
    throw e;
  }
  // The CLI session carries the mode of the last turn (a switch starts a fresh one), so resuming across modes
  // would put holdings from the transcript in front of the web tools, or the reverse.
  const lastUser = [...(existing?.messages ?? [])].reverse().find((m) => m.role === "user");
  const sameMode = !lastUser || !!(lastUser as { holdings?: boolean }).holdings === input.holdings;
  const resumeId = existing?.cliSessionId && sameMode ? existing.cliSessionId : undefined;

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (deps.signal.aborted) ac.abort();
  else deps.signal.addEventListener("abort", onAbort, { once: true });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      ac.abort();
    },
    async start(controller) {
      let open = true;
      const send = (type: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false; // the client went away; keep running to save the chat
        }
      };
      let turn = emptyTurn();
      let cliSessionId = resumeId ?? null;
      const emit = (e: AssistantEvent) => {
        turn = applyEvent(turn, e);
        if (e.type === "done" && e.cliSessionId) cliSessionId = e.cliSessionId;
        send(e.type, e);
      };

      send("session", { id: sessionId });
      if (existing?.cliSessionId && !sameMode) emit({ type: "text", delta: MODE_NOTE });
      const maxUsd = Number(env.ASSISTANT_MAX_USD);
      const timeoutMs = Number(env.ASSISTANT_TIMEOUT_MS) || 600_000;
      const attempt = async (resume?: string) => {
        let progress = false;
        let thrown = false;
        const held: AssistantEvent[] = [];
        try {
          await deps.run(
            {
              locked: true,
              args: buildArgs({ message: input.message, holdings: input.holdings, model: input.model ?? env.ASSISTANT_MODEL, resume, maxUsd: maxUsd > 0 ? maxUsd : undefined }),
              cwd: deps.cwd, signal: ac.signal, timeoutMs,
            },
            (e) => {
              if (e.type === "error") held.push(e); // a failed resume may be retried before the user sees an error
              else { progress = true; emit(e); }
            },
          );
        } catch (e) {
          thrown = true;
          held.push({ type: "error", message: e instanceof BusyError ? "The assistant is busy with another request." : e instanceof Error ? e.message : "The run failed." });
        }
        return { progress, held, thrown };
      };

      let r = await attempt(resumeId);
      if (resumeId && !r.progress && r.held.length && !r.thrown && !ac.signal.aborted) {
        emit({ type: "text", delta: RESUME_NOTE });
        r = await attempt();
      }
      r.held.forEach(emit);
      if (ac.signal.aborted && !turn.error) turn = { ...turn, error: "Stopped" };

      try {
        await repo.updateAssistantSession(sessionId, {
          cliSessionId,
          messages: [...(existing?.messages ?? []), { role: "user", text: input.message, ...(input.holdings ? { holdings: true } : {}) }, turn],
        });
      } catch (e) {
        console.error("saving the assistant chat failed", e);
        send("error", { type: "error", message: "The chat couldn't be saved." });
      }
      deps.signal.removeEventListener("abort", onAbort);
      release();
      if (open) controller.close();
    },
  });
  return { stream };
}
