"use client";

import { useEffect, useId, useState } from "react";
import { POSITION_ASSUMPTIONS, POSITION_DEFAULTS, positionSize } from "@/lib/calc/positionSize";
import { fmtInr } from "@/lib/view/portfolio";
import { Label, Panel } from "../ui";

const INPUT =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 font-mono text-sm tabular-nums text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--up)] focus:outline-none";
const STORE = "tracker.positionSizer";
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

/**
 * Risk-based position size for a long trade. Separate from the scores: it reads nothing from them and writes nothing.
 * Inputs stay in this browser only (localStorage); equity and risk % are the user's own numbers, not advice.
 */
export function PositionSizer() {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ equity: "", riskPct: String(POSITION_DEFAULTS.riskPct), entry: "", stop: "", maxAllocationPct: String(POSITION_DEFAULTS.maxAllocationPct), lotSize: "1" });

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as Partial<typeof f> | null;
      if (saved) setF((p) => ({ ...p, equity: saved.equity ?? "", riskPct: saved.riskPct ?? p.riskPct, maxAllocationPct: saved.maxAllocationPct ?? p.maxAllocationPct, lotSize: saved.lotSize ?? p.lotSize }));
    } catch {
      /* unreadable storage: start from the defaults */
    }
  }, []);
  const set = (k: keyof typeof f) => (v: string) => {
    const next = { ...f, [k]: v };
    setF(next);
    try {
      localStorage.setItem(STORE, JSON.stringify({ equity: next.equity, riskPct: next.riskPct, maxAllocationPct: next.maxAllocationPct, lotSize: next.lotSize }));
    } catch {
      /* private mode: the numbers just are not remembered */
    }
  };

  const touched = f.entry.trim() !== "" || f.stop.trim() !== "";
  const r = positionSize({ equity: num(f.equity), riskPct: num(f.riskPct), entry: num(f.entry), stop: num(f.stop), maxAllocationPct: num(f.maxAllocationPct), lotSize: num(f.lotSize) });
  const field = (k: keyof typeof f, label: string, hint?: string) => (
    <label className="flex flex-col gap-1" htmlFor={`${uid}-${k}`}>
      <Label>{label}</Label>
      <input id={`${uid}-${k}`} inputMode="decimal" value={f[k]} placeholder={hint} onChange={(e) => set(k)(e.target.value)} className={INPUT} />
      {!r.ok && touched && r.errors[k] && <span role="alert" className="text-xs text-[var(--down)]">{r.errors[k]}</span>}
    </label>
  );

  return (
    <Panel
      title="POSITION SIZE"
      action={
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="font-mono text-xs text-[var(--muted)] hover:text-[var(--text)]">
          {open ? "Hide" : "Show"}
        </button>
      }
    >
      {!open ? (
        <p className="text-xs text-[var(--muted)]">Work out how many shares keep the loss at your stop within a risk limit you choose. Not part of any score.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {field("equity", "Account equity (₹)")}
            {field("riskPct", "Risk per trade (%)")}
            {field("maxAllocationPct", "Max allocation (%)")}
            {field("entry", "Entry price")}
            {field("stop", "Stop-loss price")}
            {field("lotSize", "Lot size", "1 for shares")}
          </div>
          {r.ok ? (
            <div className="font-mono text-sm tabular-nums">
              <p>
                <span className="text-lg font-semibold">{r.quantity.toLocaleString("en-IN")}</span> shares{r.lots !== null && ` (${r.lots} lots)`} · limited by {r.limitedBy}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Capital {fmtInr(r.capitalRequired, 0)} ({r.capitalPctOfEquity.toFixed(1)}% of equity) · Max loss at the stop {fmtInr(r.maxLoss, 0)} ({r.riskPctOfEquity.toFixed(2)}% of equity) · Risk per share {fmtInr(r.riskPerShare, 2)}
              </p>
              {r.warnings.map((w) => <p key={w} className="mt-1 text-xs text-[var(--warn)]">⚠ {w}</p>)}
            </div>
          ) : touched ? (
            r.errors.quantity ? <p role="alert" className="text-xs text-[var(--down)]">{r.errors.quantity}</p> : <p className="text-xs text-[var(--muted)]">Fix the highlighted fields to see a size. No size is shown without a valid entry and stop.</p>
          ) : (
            <p className="text-xs text-[var(--muted)]">Enter an entry and a stop-loss below it.</p>
          )}
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-[var(--muted)]">
            {POSITION_ASSUMPTIONS.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </div>
      )}
    </Panel>
  );
}
