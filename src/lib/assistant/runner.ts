import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { createStreamParser, type AssistantEvent } from "./stream";

export class BusyError extends Error {
  constructor() {
    super("The assistant is already running a request.");
  }
}

let busy = false;

/** `CLAUDE_BIN`, else the native binary found on PATH (spawned directly: no shell, no quoting), else `claude`. */
export function resolveClaudeBin(env: Record<string, string | undefined>): string {
  if (env.CLAUDE_BIN) return env.CLAUDE_BIN;
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean)) {
    for (const rel of [join("node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"), "claude.exe"]) {
      const p = join(dir, rel);
      if (existsSync(p)) return p;
    }
  }
  return "claude";
}

function killTree(pid: number | undefined, child: { kill: (s?: NodeJS.Signals) => boolean }) {
  if (process.platform === "win32" && pid) {
    // the CLI starts npm/tsx children of its own; stop the whole tree
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => child.kill());
    return;
  }
  child.kill("SIGINT");
  setTimeout(() => child.kill("SIGTERM"), 2000).unref();
}

export interface RunInput {
  args: string[];
  cwd: string;
  signal: AbortSignal;
  timeoutMs: number;
  /** Defaults to resolveClaudeBin(process.env). */
  bin?: string;
}

/** Runs one CLI process and relays its events. Only one run at a time; a second call rejects with BusyError. */
export async function runAssistant(o: RunInput, onEvent: (e: AssistantEvent) => void): Promise<void> {
  if (busy) throw new BusyError();
  busy = true;
  try {
    await new Promise<void>((resolve) => {
      const parser = createStreamParser();
      let sawDone = false;
      let stderrTail = "";
      let settled = false;
      let timedOut = false;
      const emit = (events: AssistantEvent[]) => events.forEach((e) => { if (e.type === "done") sawDone = true; onEvent(e); });

      const child = spawn(o.bin ?? resolveClaudeBin(process.env), o.args, { cwd: o.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        o.signal.removeEventListener("abort", stop);
        resolve();
      };
      const stop = () => killTree(child.pid, child);
      const timer = setTimeout(() => { timedOut = true; stop(); }, o.timeoutMs);
      if (o.signal.aborted) stop();
      else o.signal.addEventListener("abort", stop, { once: true });

      child.stdout.on("data", (b: Buffer) => emit(parser.push(b.toString("utf8"))));
      child.stderr.on("data", (b: Buffer) => { stderrTail = (stderrTail + b.toString("utf8")).slice(-500); });
      child.on("error", (e: NodeJS.ErrnoException) => {
        onEvent({ type: "error", message: e.code === "ENOENT" ? "Couldn't start the Claude Code CLI. Install it and run `claude login`, or set CLAUDE_BIN." : `Couldn't start the CLI: ${e.message}` });
        finish();
      });
      child.on("close", (code) => {
        emit(parser.end());
        if (timedOut) onEvent({ type: "error", message: "The run took too long and was stopped." });
        else if (!sawDone && !o.signal.aborted) onEvent({ type: "error", message: `The assistant stopped (exit ${code}). ${stderrTail.trim()}`.trim() });
        finish();
      });
    });
  } finally {
    busy = false;
  }
}
