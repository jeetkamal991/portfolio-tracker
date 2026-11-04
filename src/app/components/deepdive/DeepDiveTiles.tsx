"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseReportContent } from "@/lib/content/claude";
import { deepDiveStats, scoreTone, type ReportTile } from "@/lib/view/deepdive";
import { StockPicker, type PickHit } from "../portfolio/StockPicker";
import { openStock } from "../popup/StockLink";
import { Chip, Label, Panel, type Tone } from "../ui";

const STATUS: Record<ReportTile["status"], Tone> = { pending: "warn", done: "up", failed: "down" };
const TONE_VAR = { up: "var(--up)", warn: "var(--warn)", down: "var(--down)", muted: "var(--muted)" } as const;

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

function preview(r: ReportTile): string {
  if (r.status === "pending") return "Waiting for Claude (checks hourly, 9 AM-10 PM).";
  if (r.status === "failed") return r.error ?? "The report failed.";
  const parsed = parseReportContent(r.content);
  return (parsed.ok && parsed.value.summary) || "Open the report to read it.";
}

function Ring({ score }: { score: number | null }) {
  const c = 2 * Math.PI * 26;
  const color = TONE_VAR[scoreTone(score)];
  return (
    <div className="relative h-[62px] w-[62px] shrink-0" title={score === null ? "No score yet" : "Technical Score today"}>
      <svg width="62" height="62" viewBox="0 0 62 62" className="-rotate-90" aria-hidden="true">
        <circle cx="31" cy="31" r="26" fill="none" stroke="var(--border)" strokeWidth="6" />
        {score !== null && (
          <circle cx="31" cy="31" r="26" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${((score / 100) * c).toFixed(1)} ${c.toFixed(1)}`} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center font-mono leading-none" style={{ color }}>
        <span className="text-lg font-semibold">{score ?? "—"}</span>
        <span className="mt-0.5 text-[8px] uppercase tracking-wider text-[var(--muted)]">score</span>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
      <Label>{label}</Label>
      <div className={`font-mono text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

export function DeepDiveTiles({ initial }: { initial: ReportTile[] }) {
  const router = useRouter();
  const [tiles, setTiles] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stats = deepDiveStats(tiles);

  async function remove(id: number) {
    setError(null);
    const res = await fetch(`/api/reports/${id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) setTiles((ts) => ts.filter((r) => r.id !== id));
    else setError("Could not delete that report");
  }

  async function request(hit: PickHit) {
    setError(null);
    setInfo(null);
    if (tiles.some((t) => t.key === hit.key && t.status === "pending")) {
      setInfo(`${hit.name} already has a report waiting for Claude.`);
      return;
    }
    setBusy(true);
    const res = await fetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: hit.key }) }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setInfo(`Requested a report for ${hit.name}. Claude checks hourly, so it appears as pending now and done later.`);
      router.refresh();
    } else setError("Could not request that report");
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">AI Deep Dive</h1>
        <p className="mt-1 text-xs text-[var(--muted)]">The ring is each stock&apos;s Technical Score today, not its score on the report date.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Reports" value={String(stats.total)} />
        <Stat label="Done" value={String(stats.done)} tone="text-[var(--up)]" />
        <Stat label="Pending" value={String(stats.pending)} tone="text-[var(--warn)]" />
        <Stat label="Failed" value={String(stats.failed)} tone="text-[var(--down)]" />
        <Stat label="Average score" value={stats.avgScore === null ? "—" : String(stats.avgScore)} tone={stats.avgScore === null ? "text-[var(--muted)]" : undefined} />
      </div>

      <Panel title="REQUEST A REPORT">
        <div className="flex flex-col gap-2" aria-busy={busy}>
          <StockPicker onPick={(h) => void request(h)} />
          {info && <p className="text-xs text-[var(--muted)]">{info}</p>}
        </div>
      </Panel>

      {error && (
        <p role="alert" className="text-xs text-[var(--down)]">
          {error}
        </p>
      )}

      {tiles.length === 0 ? (
        <Panel>
          <p className="py-6 text-center text-sm text-[var(--muted)]">No reports yet. Search a stock above and request one.</p>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {tiles.map((r) => (
            <article key={r.id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
              <div className="flex items-center gap-3">
                <Ring score={r.score} />
                <div className="min-w-0">
                  <button type="button" onClick={() => openStock(r.key, "deep")} className="line-clamp-2 text-left text-[15px] font-bold leading-snug hover:text-[var(--up)]" title="Open the stock pop-up on its AI Deep Dive tab">
                    {r.name || r.key}
                  </button>
                  <p className="mt-0.5 font-mono text-[11px] text-[var(--muted)]">
                    {r.key} · {fmtWhen(r.completedAt ?? r.requestedAt)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Chip tone={STATUS[r.status]}>{r.status}</Chip>
                {r.scoreLabel && <Chip tone={scoreTone(r.score) === "muted" ? "neutral" : (scoreTone(r.score) as Tone)}>{r.scoreLabel}</Chip>}
              </div>
              <p className="line-clamp-4 text-[13px] leading-relaxed text-[var(--muted)]">{preview(r)}</p>
              <div className="mt-auto flex items-center justify-between gap-2">
                <button type="button" onClick={() => openStock(r.key, "deep")} className="rounded-lg border border-[var(--up)] bg-[var(--up)] px-3 py-1.5 text-sm font-semibold text-[var(--bg)] hover:brightness-110">
                  Open report
                </button>
                <button type="button" onClick={() => void remove(r.id)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold text-[var(--down)] hover:bg-slate-800">
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
