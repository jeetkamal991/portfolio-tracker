"use client";

import { useState, type ReactNode } from "react";
import type { ReportContent } from "@/lib/content/claude";
import { fmtInr } from "@/lib/view/portfolio";
import type { PopupData } from "@/lib/view/popup";
import { Chip, Label, type Tone } from "../ui";
import { mutate } from "@/lib/client/cache";

/** "bullish_engulfing" / "morningStar" → "Bullish Engulfing" / "Morning Star". */
const titleCase = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/w/g, (c) => c.toUpperCase());

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

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--border)] pt-3 first:border-t-0 first:pt-0">
      <h4 className="mb-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{title}</h4>
      {children}
    </section>
  );
}

function LevelChips({ label, values }: { label: string; values: number[] }) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-20 text-sm font-semibold">{label}</span>
      {values.map((v, i) => (
        <span
          key={i}
          className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-0.5 font-mono text-xs tabular-nums"
        >
          {fmtInr(v)}
        </span>
      ))}
    </div>
  );
}

/** Structured sections for a report whose content parsed against the spec shape. */
function StructuredReport({ c }: { c: ReportContent }) {
  const t = c.technicals;
  const text: [string, string | undefined][] = [
    ["Trend", t.trend],
    ["Momentum", t.momentum],
    ["Volume", t.volume],
  ];
  const fundamentals = Object.entries(c.fundamentals);
  const hasTechnicals = text.some(([, v]) => v) || t.support.length > 0 || t.resistance.length > 0 || t.notes;
  const { bullish, bearish } = c.scenarios;
  return (
    <div className="flex flex-col gap-3">
      {c.summary && (
        <Block title="Summary">
          <p className="whitespace-pre-line text-sm leading-relaxed">{c.summary}</p>
        </Block>
      )}
      {fundamentals.length > 0 && (
        <Block title="Fundamentals">
          <dl className="flex flex-col gap-2">
            {fundamentals.map(([k, v]) => (
              <div key={k}>
                <dt className="text-sm font-semibold">{titleCase(k)}</dt>
                <dd className="whitespace-pre-line text-sm leading-relaxed text-[var(--muted)]">{v}</dd>
              </div>
            ))}
          </dl>
        </Block>
      )}
      {hasTechnicals && (
        <Block title="Technicals">
          <div className="flex flex-col gap-2">
            {text.map(([k, v]) =>
              v ? (
                <div key={k}>
                  <span className="text-sm font-semibold">{k}</span>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--muted)]">{v}</p>
                </div>
              ) : null,
            )}
            <LevelChips label="Support" values={t.support} />
            <LevelChips label="Resistance" values={t.resistance} />
            {t.notes && <p className="whitespace-pre-line text-sm leading-relaxed">{t.notes}</p>}
          </div>
        </Block>
      )}
      {(bullish || bearish) && (
        <Block title="Scenarios">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {bullish && (
              <div className="rounded-lg border border-[var(--up)]/40 bg-[var(--panel)] p-3">
                <div className="text-sm font-semibold text-[var(--up)]">Bullish</div>
                <p className="mt-1 text-sm leading-relaxed">{bullish.case}</p>
                {bullish.confirmAbove !== null && (
                  <p className="mt-1 font-mono text-xs tabular-nums text-[var(--muted)]">confirms above {fmtInr(bullish.confirmAbove)}</p>
                )}
              </div>
            )}
            {bearish && (
              <div className="rounded-lg border border-[var(--down)]/40 bg-[var(--panel)] p-3">
                <div className="text-sm font-semibold text-[var(--down)]">Bearish</div>
                <p className="mt-1 text-sm leading-relaxed">{bearish.case}</p>
                {bearish.invalidateBelow !== null && (
                  <p className="mt-1 font-mono text-xs tabular-nums text-[var(--muted)]">invalidates below {fmtInr(bearish.invalidateBelow)}</p>
                )}
              </div>
            )}
          </div>
        </Block>
      )}
      {c.risks.length > 0 && (
        <Block title="Risks">
          <ul className="ml-4 list-disc space-y-1 text-sm">
            {c.risks.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </Block>
      )}
      {c.sources.length > 0 && (
        <Block title="Sources">
          <ul className="space-y-1 text-sm">
            {c.sources.map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[var(--up)] hover:underline">
                  {s.title || s.url} ↗
                </a>
              </li>
            ))}
          </ul>
        </Block>
      )}
      <p className="text-xs text-[var(--muted)]">{c.disclaimer}</p>
    </div>
  );
}

function ReportCard({ r, onRetry, retryDisabled }: { r: Report; onRetry: () => void; retryDisabled: boolean }) {
  return (
    <article className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Chip tone={STATUS[r.status] ?? "neutral"}>{r.status.toUpperCase()}</Chip>
        <span className="font-mono text-[11px] text-[var(--muted)]">Requested {fmtWhen(r.requestedAt)}</span>
        {r.completedAt && <span className="font-mono text-[11px] text-[var(--muted)]">Completed {fmtWhen(r.completedAt)}</span>}
      </div>
      {r.status === "done" &&
        (r.parsed.ok ? (
          <StructuredReport c={r.parsed.value} />
        ) : (
          <div className="flex flex-col gap-3">
            <Value value={r.content} depth={0} />
            <p className="text-xs text-[var(--muted)]">Analysis, not investment advice.</p>
          </div>
        ))}
      {r.status === "failed" && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-[var(--down)]">{r.error ?? "Report failed"}</p>
          <button
            type="button"
            onClick={onRetry}
            disabled={retryDisabled}
            className="rounded-lg border border-[var(--border)] bg-slate-800 px-3 py-1 text-sm font-medium text-[var(--up)] hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Request again
          </button>
        </div>
      )}
      {r.status === "pending" && (
        <p className="text-sm text-[var(--muted)]">
          Pending since {fmtWhen(r.requestedAt)} — Claude checks for new requests every hour (9 AM–10 PM)
        </p>
      )}
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
      const res = await mutate("/api/reports", {
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
        sorted.map((r) => <ReportCard key={r.id} r={r} onRetry={request} retryDisabled={busy || pending} />)
      )}
    </div>
  );
}
