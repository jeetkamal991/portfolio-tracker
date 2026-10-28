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

/** Takes the single run slot; returns its release function, or null when a run is in progress. */
export function acquireRun(): (() => void) | null {
  if (busy) return null;
  busy = true;
  return () => { busy = false; };
}

const CLI_ENV = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|USERPROFILE|HOME|HOMEDRIVE|HOMEPATH|USERNAME|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|TEMP|TMP|TMPDIR|LANG|LC_ALL|TERM|SHELL|CLAUDE_.*|ANTHROPIC_.*)$/i;

/** The CLI and the commands it runs get the login/system variables only, never the server's keys (Supabase, Telegram). */
export function cliEnv(src: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) if (v !== undefined && CLI_ENV.test(k)) out[k] = v;
  out.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  return out;
}

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
  /** The caller already took the slot with acquireRun() and releases it itself. */
  locked?: boolean;
}

/** Runs one CLI process and relays its events. Only one run at a time; a second call rejects with BusyError. */
export async function runAssistant(o: RunInput, onEvent: (e: AssistantEvent) => void): Promise<void> {
  const release = o.locked ? () => {} : acquireRun();
  if (!release) throw new BusyError();
  try {
    await new Promise<void>((resolve) => {
      const parser = createStreamParser();
      let sawDone = false;
      let stderrTail = "";
      let settled = false;
      let timedOut = false;
      const emit = (events: AssistantEvent[]) => events.forEach((e) => { if (e.type === "done") sawDone = true; onEvent(e); });

      const child = spawn(o.bin ?? resolveClaudeBin(process.env), o.args, { cwd: o.cwd, env: cliEnv(process.env) as NodeJS.ProcessEnv, shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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

      // setEncoding decodes across chunk boundaries, so a multi-byte character (₹) split between reads survives
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (b: string) => emit(parser.push(b)));
      child.stderr.on("data", (b: string) => { stderrTail = (stderrTail + b).slice(-500); });
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
    release();
  }
}

