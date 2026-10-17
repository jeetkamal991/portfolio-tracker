"use client";

import { useState, type ReactNode } from "react";
import type { PopupData } from "@/lib/view/popup";
import { Chip, Label, type Tone } from "../ui";
import { titleCase } from "./PatternsTab";

type Report = PopupData["reports"][number];

const STATUS: Record<string, Tone> = { pending: "warn", done: "up", failed: "down" };

const fmtWhen = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Report content is free-form jsonb sections; render strings, lists and nested objects generically. */
function Value({ value, depth }: { value: unknown; depth: number }): ReactNode {
  if (value === null || value === undefined || value === "") return <span className="text-[var(--muted)]">—</span>;
  if (typeof value === "string") return <p className="whitespace-pre-line text-sm leading-relaxed">{value}</p>;
  if (typeof value === "number" || typeof value === "boolean") return <span className="font-mono text-sm">{String(value)}</span>;
  if (Array.isArray(value)) {
    return (
      <ul className="ml-4 list-disc space-y-1 text-sm">
        {value.map((v, i) => (
          <li key={i}>
            <Value value={v} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }
  if (isRecord(value)) {
    // A { title|heading, body|content|text } pair reads as one section.
    const title = value.title ?? value.heading;
    const body = value.body ?? value.content ?? value.text;
    if (typeof title === "string" && body !== undefined && Object.keys(value).length === 2) {
      return <Section title={title} value={body} depth={depth} />;
    }
    return (
      <div className="flex flex-col gap-2">
        {Object.entries(value).map(([k, v]) => (
          <Section key={k} title={titleCase(k)} value={v} depth={depth} />
        ))}
      </div>
    );
  }
  return null;
}

function Section({ title, value, depth }: { title: string; value: unknown; depth: number }) {
  return (
    <section className={depth === 0 ? "border-t border-[var(--border)] pt-3 first:border-t-0 first:pt-0" : ""}>
      {depth === 0 ? (
        <h4 className="mb-1 font-mono text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</h4>
      ) : (
        <h5 className="text-sm font-semibold">{title}</h5>
      )}
      <Value value={value} depth={depth + 1} />
    </section>
  );
}

function ReportCard({ r }: { r: Report }) {
  return (
    <article className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Chip tone={STATUS[r.status] ?? "neutral"}>{r.status.toUpperCase()}</Chip>
        <span className="font-mono text-[11px] text-[var(--muted)]">Requested {fmtWhen(r.requestedAt)}</span>
        {r.completedAt && <span className="font-mono text-[11px] text-[var(--muted)]">Completed {fmtWhen(r.completedAt)}</span>}
      </div>
      {r.status === "done" && (
        <div className="flex flex-col gap-3">
          <Value value={r.content} depth={0} />
          <p className="text-xs text-[var(--muted)]">Analysis, not investment advice.</p>
        </div>
      )}
      {r.status === "failed" && <p className="text-sm text-[var(--down)]">{r.error ?? "Report failed"}</p>}
      {r.status === "pending" && <p className="text-sm text-[var(--muted)]">Queued. Claude picks up pending reports hourly.</p>}
    </article>
  );
}

export function DeepDiveTab({ stockKey, reports, onRequested }: { stockKey: string; reports: Report[]; onRequested: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Report count when a request succeeded: keeps the button disabled until the refetch shows the new row.
  const [waitingFor, setWaitingFor] = useState<number | null>(null);
  const sorted = [...reports].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const pending = sorted.some((r) => r.status === "pending") || (waitingFor !== null && reports.length <= waitingFor);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: stockKey }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setWaitingFor(reports.length);
      onRequested();
    } catch {
      setError("Could not request a report");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label>CLAUDE REPORTS · NEWEST FIRST</Label>
        <button
          type="button"
          onClick={request}
          disabled={busy || pending}
          title={pending ? "A report is already pending" : undefined}
          className="rounded-lg border border-[var(--border)] bg-slate-800 px-3 py-1.5 text-sm font-medium text-[var(--up)] hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Requesting…" : "Request new report"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-[var(--down)]">
          {error}
        </p>
      )}
      {sorted.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--muted)]">No report yet</p>
      ) : (
        sorted.map((r) => <ReportCard key={r.id} r={r} />)
      )}
    </div>
  );
}
