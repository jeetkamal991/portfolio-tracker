"use client";

import type { StoredDay } from "@/lib/db/types";
import { fmtPct, fmtPrice } from "@/lib/view/dashboard";
import { buildNiftyCard, type EmaState, type NiftyTrend } from "@/lib/view/nifty";
import { useQuotes } from "../QuotesProvider";
import { Chip, Label, Panel, type Tone } from "../ui";

const NIFTY_TICKER = "^NSEI";

const TREND: Record<Exclude<NiftyTrend, null>, { tone: Tone; label: string }> = {
  above_all: { tone: "up", label: "ABOVE ALL EMAs" },
  mixed: { tone: "warn", label: "MIXED" },
  below_all: { tone: "down", label: "BELOW ALL EMAs" },
};

function Stat({ label, value, tone = "" }: { label: string; value: number | null; tone?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <span className={`font-mono text-sm font-semibold tabular-nums ${tone}`}>{fmtPrice(value)}</span>
    </div>
  );
}

function EmaCard({ label, state }: { label: string; state: EmaState }) {
  const tint =
    state.above === null
      ? "border-[var(--border)] bg-[var(--panel-2)]"
      : state.above
        ? "border-emerald-500/30 bg-emerald-950/30"
        : "border-rose-500/30 bg-rose-950/30";
  const word = state.above === null ? "—" : state.above ? "Above" : "Below";
  const wordTone = state.above === null ? "text-[var(--muted)]" : state.above ? "text-[var(--up)]" : "text-[var(--down)]";
  return (
    <div className={`flex flex-col gap-1 rounded-lg border p-3 ${tint}`}>
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <span className={`font-mono text-[11px] font-semibold uppercase ${wordTone}`}>{word}</span>
      </div>
      <span className="font-mono text-base font-semibold tabular-nums">{fmtPrice(state.value)}</span>
    </div>
  );
}

export function NiftyCard({ days }: { days: StoredDay[] }) {
  const { quotes } = useQuotes();
  const q = quotes[NIFTY_TICKER];
  const c = buildNiftyCard(days, q ? { price: q.price, changePct: q.changePct, dayHigh: q.dayHigh, dayLow: q.dayLow } : null);
  const dir = c.changePct === null || c.changePct === 0 ? 0 : c.changePct > 0 ? 1 : -1;
  const moveTone = dir > 0 ? "text-[var(--up)]" : dir < 0 ? "text-[var(--down)]" : "text-[var(--muted)]";
  const arrow = dir > 0 ? "▲" : dir < 0 ? "▼" : "";
  const change =
    c.change === null ? "" : `${c.change > 0 ? "+" : c.change < 0 ? "-" : ""}${fmtPrice(Math.abs(c.change))} `;

  return (
    <Panel>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Label>BENCHMARK INDEX · NSE: ^NSEI</Label>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-mono text-4xl font-extrabold tabular-nums">{fmtPrice(c.cmp)}</span>
            <span className={`font-mono text-base font-semibold tabular-nums ${moveTone}`}>
              {arrow} {change}({fmtPct(c.changePct)})
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
            <Stat label="PREV CLOSE" value={c.prevClose} />
            <Stat label="DAY HIGH" value={c.dayHigh} tone="text-[var(--up)]" />
            <Stat label="DAY LOW" value={c.dayLow} tone="text-[var(--down)]" />
            <Stat label="52W HIGH" value={c.high52} />
            <Stat label="52W LOW" value={c.low52} />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <Label>AUTOMATED EMA ANALYSIS</Label>
            {c.trend && <Chip tone={TREND[c.trend].tone}>{TREND[c.trend].label}</Chip>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <EmaCard label="EMA 20" state={c.ema20} />
            <EmaCard label="EMA 50" state={c.ema50} />
            <EmaCard label="EMA 200" state={c.ema200} />
          </div>
        </div>
      </div>
    </Panel>
  );
}
