"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { CONDITIONS, type AlertCondition } from "@/lib/calc/alerts";
import type { AlertSnapshot } from "@/lib/api/alerts";
import { fmtInr } from "@/lib/view/portfolio";
import { ScoreLabelChip } from "../popup/ScoreBadge";
import { StockPicker } from "../portfolio/StockPicker";
import { Label, Panel } from "../ui";

const INPUT =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 font-mono text-sm tabular-nums text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--up)] focus:outline-none";
const USER_CONDITIONS = CONDITIONS.filter((c) => c.userCreatable);
const NEEDS_VALUE = new Set(CONDITIONS.filter((c) => c.needsValue).map((c) => c.id));

const fmtNum = (v: number | null, dp = 2) => (v === null ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp }));

/** New alert: pick a stock or index, a condition, a price when the condition needs one, and once / every time. */
export function AlertForm({ initial }: { initial: AlertSnapshot | null }) {
  const uid = useId();
  const router = useRouter();
  const [picked, setPicked] = useState<{ key: string; name: string } | null>(initial ? { key: initial.key, name: initial.name } : null);
  const [snap, setSnap] = useState<AlertSnapshot | null>(initial);
  const [condition, setCondition] = useState<AlertCondition>("price_above");
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"once" | "repeat">("once");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!picked || snap?.key === picked.key) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/alerts/snapshot/${encodeURIComponent(picked.key)}`, { signal: ctrl.signal });
        if (res.ok) setSnap((await res.json()) as AlertSnapshot);
      } catch {
        // aborted or offline: the form still works without the values
      }
    })();
    return () => ctrl.abort();
  }, [picked, snap?.key]);

  const needsValue = NEEDS_VALUE.has(condition);

  async function save() {
    if (!picked || saving) return;
    setSaving(true);
    setError(null);
    setDone(null);
    try {
      const num = Number(value.replace(/,/g, ""));
      if (needsValue && (!value.trim() || !Number.isFinite(num) || num <= 0)) {
        setError("Enter a price above 0");
        return;
      }
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: picked.key, condition, mode, ...(needsValue && { value: num }) }),
      });
      if (res.ok) {
        const { alreadyTrue } = (await res.json()) as { alreadyTrue: boolean };
        setDone(alreadyTrue ? "Alert created — this is already true now, so it will fire the next time it becomes true." : "Alert created");
        setValue("");
        router.refresh();
        return;
      }
      const data: { errors?: Record<string, string>; error?: string } = await res.json().catch(() => ({}));
      setError(data.errors ? Object.values(data.errors).join(" · ") : data.error === "not_found" ? "Unknown stock" : "Could not create the alert");
    } catch {
      setError("Could not create the alert");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title="New alert">
      <div className="flex flex-col gap-4">
        {!picked ? (
          <StockPicker scope="all" onPick={(h) => { setPicked(h); setDone(null); }} />
        ) : (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate font-medium">
              {picked.name} <span className="font-mono text-xs text-[var(--muted)]">({picked.key})</span>
            </span>
            <button
              type="button"
              onClick={() => { setPicked(null); setSnap(null); setDone(null); setError(null); }}
              className="shrink-0 text-xs text-[var(--muted)] hover:text-[var(--text)]"
            >
              Change
            </button>
          </div>
        )}

        {picked && snap?.key === picked.key && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 text-xs">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono tabular-nums">{snap.type === "stock" ? `CMP ${fmtInr(snap.price, 2)}` : `Close ${fmtNum(snap.price)}`}</span>
              {snap.score !== null && snap.scoreLabel !== null && <ScoreLabelChip label={snap.scoreLabel} score={snap.score} />}
            </div>
            <div className="mt-1 font-mono tabular-nums text-[var(--muted)]">
              EMA 20 {fmtNum(snap.ema20)} · EMA 50 {fmtNum(snap.ema50)} · EMA 200 {fmtNum(snap.ema200)} · RSI {fmtNum(snap.rsi14, 1)}
            </div>
            {snap.price === null && <p className="mt-2 text-[var(--warn)]">No stored price yet — the alert will start once there is one.</p>}
          </div>
        )}

        {picked && (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${uid}-cond`}>
                  <Label>Condition</Label>
                </label>
                <select
                  id={`${uid}-cond`}
                  value={condition}
                  onChange={(e) => { setCondition(e.target.value as AlertCondition); setError(null); }}
                  className={INPUT}
                >
                  {USER_CONDITIONS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              {needsValue && (
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${uid}-value`}>
                    <Label>Price</Label>
                  </label>
                  <input
                    id={`${uid}-value`}
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => { setValue(e.target.value); setError(null); }}
                    placeholder={snap?.price != null ? fmtNum(snap.price) : "Price"}
                    className={INPUT}
                  />
                </div>
              )}
            </div>

            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1"><Label>Fires</Label></legend>
              <div className="inline-flex w-fit rounded-lg border border-[var(--border)] p-0.5">
                {([["once", "Once"], ["repeat", "Every time"]] as const).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => setMode(m)}
                    className={`rounded-md px-3 py-1 text-sm ${mode === m ? "bg-slate-800 text-[var(--up)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            {error && <p role="alert" className="text-xs text-[var(--down)]">{error}</p>}
            {done && <p role="status" className="text-xs text-[var(--up)]">{done}</p>}
            <button
              type="submit"
              disabled={saving}
              className="w-fit rounded-lg border border-[var(--border)] bg-slate-800 px-4 py-2 text-sm font-medium text-[var(--up)] hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Create alert"}
            </button>
          </form>
        )}
      </div>
    </Panel>
  );
}
