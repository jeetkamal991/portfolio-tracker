"use client";

import { useState } from "react";
import { parseReportContent } from "@/lib/content/claude";
import type { ReportWithStock } from "@/lib/db/types";
import { openStock } from "../popup/StockLink";
import { Chip, Panel, type Tone } from "../ui";

const STATUS: Record<ReportWithStock["status"], Tone> = { pending: "warn", done: "up", failed: "down" };

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

function preview(r: ReportWithStock): string {
  if (r.status === "pending") return "Waiting for Claude (checks hourly, 9 AM-10 PM).";
  if (r.status === "failed") return r.error ?? "The report failed.";
  const parsed = parseReportContent(r.content);
  return (parsed.ok && parsed.value.summary) || "Open to read the report.";
}

export function DeepDiveTiles({ initial }: { initial: ReportWithStock[] }) {
  const [reports, setReports] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: number) {
    setError(null);
    const res = await fetch(`/api/reports/${id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) setReports((rs) => rs.filter((r) => r.id !== id));
    else setError("Could not delete that report");
  }

  return (
    <Panel title="AI DEEP DIVE · ALL REPORTS" action={<span className="text-xs text-[var(--muted)]">{reports.length} reports</span>}>
      {error && (
        <p role="alert" className="mb-3 text-xs text-[var(--down)]">
          {error}
        </p>
      )}
      {reports.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--muted)]">No reports yet. Open a stock, go to AI Deep Dive and press Request new report.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {reports.map((r) => (
            <article key={r.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => openStock(r.key, "deep")}
                  className="min-w-0 truncate text-left text-sm font-semibold hover:text-[var(--up)]"
                  title="Open the stock pop-up on its AI Deep Dive tab"
                >
                  {r.name || r.key}
                </button>
                <Chip tone={STATUS[r.status]}>{r.status}</Chip>
              </div>
              <p className="font-mono text-[11px] text-[var(--muted)]">
                {r.key} · {fmtWhen(r.completedAt ?? r.requestedAt)}
              </p>
              <p className="line-clamp-4 text-sm leading-relaxed">{preview(r)}</p>
              <div className="mt-auto flex justify-end">
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--down)] hover:bg-slate-800"
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}
