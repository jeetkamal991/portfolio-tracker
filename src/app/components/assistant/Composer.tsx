"use client";

import { useEffect, useRef } from "react";

export const MODELS = [
  { id: "claude-sonnet-5-5", label: "Sonnet" },
  { id: "claude-opus-5-5", label: "Opus" },
];

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  disabled: boolean;
  holdings: boolean;
  onHoldings: (v: boolean) => void;
  model: string;
  onModel: (v: string) => void;
}

export function Composer(p: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [p.value]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
      <textarea
        ref={ref}
        rows={2}
        value={p.value}
        disabled={p.disabled}
        maxLength={4000}
        placeholder={p.disabled ? "The assistant runs only on your PC" : "Ask about a stock, a strategy or your holdings"}
        aria-label="Message"
        onChange={(e) => p.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!p.running && p.value.trim()) p.onSend();
          }
        }}
        className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-[var(--muted)]" title="Includes your positions. The web tools are switched off for the run.">
          <input type="checkbox" checked={p.holdings} disabled={p.running || p.disabled} onChange={(e) => p.onHoldings(e.target.checked)} />
          Include my holdings
        </label>
        <select
          aria-label="Model"
          value={p.model}
          disabled={p.running || p.disabled}
          onChange={(e) => p.onModel(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 font-mono text-xs"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <div className="ml-auto">
          {p.running ? (
            <button type="button" onClick={p.onStop} className="rounded-md border border-[var(--down)] px-4 py-1.5 text-sm font-semibold text-[var(--down)]">
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={p.onSend}
              disabled={p.disabled || !p.value.trim()}
              className="rounded-md bg-[var(--up)] px-4 py-1.5 text-sm font-semibold text-[var(--bg)] disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
