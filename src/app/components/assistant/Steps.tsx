import type { AssistantTurn } from "@/lib/view/assistant";
import { stepLabel } from "@/lib/view/assistant";

/** One collapsed row per tool call; open a row for the raw output. */
export function Steps({ steps, running }: { steps: AssistantTurn["steps"]; running: boolean }) {
  if (steps.length === 0) return null;
  return (
    <ul className="mb-3 flex flex-col gap-1">
      {steps.map((s, i) => {
        const pending = running && i === steps.length - 1 && s.output === "" && s.ok;
        return (
          <li key={s.id}>
            <details className="group rounded-md border border-[var(--border)] bg-[var(--panel-2)]">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 font-mono text-xs text-[var(--muted)]">
                <span className={s.ok ? (pending ? "animate-pulse text-[var(--warn)]" : "text-[var(--up)]") : "text-[var(--down)]"}>{s.ok ? (pending ? "…" : "✓") : "✗"}</span>
                <span className="min-w-0 flex-1 truncate">{stepLabel(s.name, s.summary)}</span>
              </summary>
              <pre className="max-h-64 overflow-auto border-t border-[var(--border)] px-3 py-2 font-mono text-[11px] whitespace-pre-wrap text-[var(--muted)]">
                {s.summary}
                {s.output ? `\n\n${s.output}` : ""}
              </pre>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
