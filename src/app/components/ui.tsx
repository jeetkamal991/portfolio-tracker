import type { ReactNode } from "react";
import { fmtPct, pctTone } from "@/lib/view/dashboard";

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</h2>
          )}
          {action && <div className="text-sm">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">{children}</span>;
}

export type Tone = "up" | "down" | "warn" | "neutral";

const TONE: Record<Tone, string> = {
  up: "text-[var(--up)] bg-[color-mix(in_srgb,var(--up)_15%,transparent)] border-[color-mix(in_srgb,var(--up)_40%,transparent)]",
  down: "text-[var(--down)] bg-[color-mix(in_srgb,var(--down)_15%,transparent)] border-[color-mix(in_srgb,var(--down)_40%,transparent)]",
  warn: "text-[var(--warn)] bg-[color-mix(in_srgb,var(--warn)_15%,transparent)] border-[color-mix(in_srgb,var(--warn)_40%,transparent)]",
  neutral: "text-[var(--muted)] bg-[color-mix(in_srgb,var(--muted)_15%,transparent)] border-[color-mix(in_srgb,var(--muted)_40%,transparent)]",
};

export function Chip({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export function PctText({ value, className = "" }: { value: number | null; className?: string }) {
  return <span className={`font-mono tabular-nums ${pctTone(value)} ${className}`}>{fmtPct(value)}</span>;
}
