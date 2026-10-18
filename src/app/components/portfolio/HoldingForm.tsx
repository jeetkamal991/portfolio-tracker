"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { mergeHolding, validateHoldingInput, type HoldingInput } from "@/lib/calc/portfolio";
import type { PrefillData } from "@/lib/api/portfolio";
import { istDate } from "@/lib/time/ist";
import { fmtPct, pctTone } from "@/lib/view/dashboard";
import { fmtInr, fmtSignedInr } from "@/lib/view/portfolio";
import { ScoreLabelChip } from "../popup/ScoreBadge";
import { Label } from "../ui";
import { StockPicker, type PickHit } from "./StockPicker";

export interface HeldHolding extends HoldingInput { key: string; name: string }

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const INPUT =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 font-mono text-sm tabular-nums text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--up)] focus:outline-none";

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const level = (v: number | null) => (v === null ? "" : String(Number(v.toFixed(2))));

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id}>
        <Label>{label}</Label>
      </label>
      {children}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-xs text-[var(--down)]">
          {error}
        </p>
      )}
    </div>
  );
}

/** Add / edit modal. Remount it (via `key`) to switch stock or mode. */
export function HoldingForm({
  mode,
  initialKey,
  holdings,
  opener,
  onClose,
}: {
  mode: "add" | "edit";
  initialKey: string | null;
  holdings: HeldHolding[];
  opener: HTMLElement | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const uid = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const priceTouched = useRef(false);
  const today = istDate(new Date());

  const editing = mode === "edit" ? (holdings.find((h) => h.key === initialKey) ?? null) : null;
  const [picked, setPicked] = useState<PickHit | null>(
    editing ? { key: editing.key, name: editing.name } : initialKey ? { key: initialKey, name: initialKey } : null,
  );
  const [prefill, setPrefill] = useState<PrefillData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qty, setQty] = useState(editing ? String(editing.qty) : "");
  const [price, setPrice] = useState(editing ? level(editing.avgPrice) : "");
  const [date, setDate] = useState(editing ? editing.buyDate : today);
  const [sl, setSl] = useState(editing ? level(editing.stopLoss) : "");
  const [t1, setT1] = useState(editing ? level(editing.target1) : "");
  const [t2, setT2] = useState(editing ? level(editing.target2) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pickedKey = picked?.key ?? null;

  // Prefill strip: fetched whenever a stock is picked.
  useEffect(() => {
    if (!pickedKey) return;
    const ctrl = new AbortController();
    setLoading(true);
    setLoadError(null);
    setPrefill(null);
    (async () => {
      try {
        const res = await fetch(`/api/holdings/prefill/${encodeURIComponent(pickedKey)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as PrefillData;
        setPrefill(data);
        setPicked((p) => (p && p.key === data.key ? { key: data.key, name: data.name } : p));
        if (mode === "add" && !priceTouched.current && data.cmp !== null) setPrice(String(Number(data.cmp.toFixed(2))));
      } catch {
        if (!ctrl.signal.aborted) setLoadError("Could not load details for this stock");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [pickedKey, mode]);

  // Modal behaviour: focus in, scroll lock, focus back to the opener on close.
  // Esc and the Tab trap listen on the document: picking a stock or pressing "Change" unmounts
  // the focused element, and focus can land on <body>, outside the dialog.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = dialogRef.current?.querySelector<HTMLElement>("input");
    first?.focus();

    function onKeyDown(e: globalThis.KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement;
      const inside = dialog.contains(active) && active !== dialog;
      if (e.shiftKey && (active === firstEl || !inside)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && (active === lastEl || !inside)) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      if (opener && opener.isConnected) opener.focus();
    };
  }, [opener]);

  // After a pick, focus Quantity; after "Change", the search box. Runs once the new fields exist.
  const focusNext = useRef<"qty" | "search" | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const el =
      target === "qty"
        ? document.getElementById(`${uid}-qty`)
        : dialogRef.current?.querySelector<HTMLElement>('input[type="search"]');
    el?.focus();
  }, [pickedKey, uid]);

  function pick(hit: PickHit) {
    focusNext.current = "qty";
    setPicked(hit);
  }

  const cmp = prefill?.cmp ?? null;
  const held = mode === "add" ? (prefill?.held ?? null) : null;

  // Live preview and warnings, computed on the current field values.
  const q = num(qty);
  const p = num(price);
  const incoming: HoldingInput | null =
    Number.isInteger(q) && q > 0 && p > 0
      ? { qty: q, avgPrice: p, buyDate: date, stopLoss: null, target1: null, target2: null }
      : null;
  const invested = incoming ? incoming.qty * incoming.avgPrice : null;
  const value = incoming && cmp !== null ? incoming.qty * cmp : null;
  const pnl = invested !== null && value !== null ? value - invested : null;
  const newAvg = incoming && held ? mergeHolding(held, incoming).avgPrice : null;
  const check = validateHoldingInput({ qty, avgPrice: price, buyDate: date, stopLoss: sl, target1: t1, target2: t2 }, { today, cmp });
  const warnings = check.ok ? check.warnings : [];

  function useSuggested() {
    if (!prefill) return;
    setSl(level(prefill.support));
    setT1(level(prefill.resistance));
    setT2(level(prefill.nextResistance));
  }

  function clearErr(field: string) {
    setErrors((e) => {
      if (!(field in e)) return e;
      const rest = { ...e };
      delete rest[field];
      return rest;
    });
  }

  async function save() {
    if (!picked || saving) return;
    setSaving(true);
    setFormError(null);
    setErrors({});
    try {
      // An untouched edit keeps the exact stored average; the box shows it to 2 decimals.
      const avgPrice = editing && !priceTouched.current ? String(editing.avgPrice) : price;
      const body = { key: picked.key, qty, avgPrice, buyDate: date, stopLoss: sl, target1: t1, target2: t2 };
      const res = await fetch(mode === "edit" ? `/api/holdings/${encodeURIComponent(picked.key)}` : "/api/holdings", {
        method: mode === "edit" ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onClose();
        router.refresh();
        return;
      }
      const data: { errors?: Record<string, string>; error?: string } = await res.json().catch(() => ({}));
      if (data.errors) setErrors(data.errors);
      else setFormError(data.error ?? "Could not save holding");
    } catch {
      setFormError("Could not save holding");
    } finally {
      setSaving(false);
    }
  }

  const title = mode === "edit" ? "Edit holding" : "Add holding";
  const hint = (suffix: string, v: number | null) => (v === null ? suffix : `${suffix} ${fmtInr(v, 2)}`);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/60 p-3 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        tabIndex={-1}
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={`${uid}-title`} className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--muted)] hover:text-[var(--text)]">
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {mode === "add" && !picked && <StockPicker autoFocus onPick={pick} />}
          {mode === "add" && picked && !editing && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate font-medium">
                {picked.name} <span className="font-mono text-xs text-[var(--muted)]">({picked.key})</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  focusNext.current = "search";
                  setPicked(null);
                  setPrefill(null);
                  setLoadError(null);
                  priceTouched.current = false;
                  setPrice("");
                }}
                className="shrink-0 text-xs text-[var(--muted)] hover:text-[var(--text)]"
              >
                Change
              </button>
            </div>
          )}
          {mode === "edit" && picked && (
            <div className="text-sm font-medium">
              {picked.name} <span className="font-mono text-xs text-[var(--muted)]">({picked.key})</span>
            </div>
          )}

          {picked && loading && <p className="text-xs text-[var(--muted)]">Loading stock details…</p>}
          {loadError && (
            <p role="alert" className="text-xs text-[var(--down)]">
              {loadError}
            </p>
          )}
          {prefill && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 text-xs">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{prefill.name}</span>
                {prefill.sectorName && <span className="text-[var(--muted)]">{prefill.sectorName}</span>}
                <span className="font-mono tabular-nums">
                  CMP {fmtInr(prefill.cmp, 2)}{" "}
                  {prefill.dayPct !== null && <span className={pctTone(prefill.dayPct)}>{fmtPct(prefill.dayPct)}</span>}
                </span>
                {prefill.score !== null && prefill.scoreLabel !== null && (
                  <ScoreLabelChip label={prefill.scoreLabel} score={prefill.score} />
                )}
              </div>
              <div className="mt-1 font-mono tabular-nums text-[var(--muted)]">
                Support {fmtInr(prefill.support, 2)} · Resistance {fmtInr(prefill.resistance, 2)}
              </div>
              {held && (
                <p className="mt-2 text-[var(--warn)]">
                  You hold {held.qty.toLocaleString("en-IN")} @ {fmtInr(held.avgPrice, 2)} — this adds to it (new average shown below)
                </p>
              )}
              {prefill.cmp === null && <p className="mt-2 text-[var(--warn)]">No price yet for this stock; value and P/L will show once it has one.</p>}
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
                <Field id={`${uid}-qty`} label="Quantity" error={errors.qty}>
                  <input
                    id={`${uid}-qty`}
                    inputMode="numeric"
                    value={qty}
                    onChange={(e) => {
                      setQty(e.target.value);
                      clearErr("qty");
                    }}
                    aria-invalid={!!errors.qty}
                    aria-describedby={errors.qty ? `${uid}-qty-err` : undefined}
                    className={INPUT}
                  />
                </Field>
                <Field id={`${uid}-price`} label="Buy price" error={errors.avgPrice}>
                  <input
                    id={`${uid}-price`}
                    inputMode="decimal"
                    value={price}
                    onChange={(e) => {
                      priceTouched.current = true;
                      setPrice(e.target.value);
                      clearErr("avgPrice");
                    }}
                    aria-invalid={!!errors.avgPrice}
                    aria-describedby={errors.avgPrice ? `${uid}-price-err` : undefined}
                    className={INPUT}
                  />
                </Field>
                <Field id={`${uid}-date`} label="Buy date" error={errors.buyDate}>
                  <input
                    id={`${uid}-date`}
                    type="date"
                    max={today}
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);
                      clearErr("buyDate");
                    }}
                    aria-invalid={!!errors.buyDate}
                    aria-describedby={errors.buyDate ? `${uid}-date-err` : undefined}
                    className={INPUT}
                  />
                </Field>
                <div className="hidden sm:block" />
                <Field id={`${uid}-sl`} label="Stop loss" error={errors.stopLoss}>
                  <input
                    id={`${uid}-sl`}
                    inputMode="decimal"
                    value={sl}
                    placeholder={hint("support", prefill?.support ?? null)}
                    onChange={(e) => {
                      setSl(e.target.value);
                      clearErr("stopLoss");
                    }}
                    aria-invalid={!!errors.stopLoss}
                    aria-describedby={errors.stopLoss ? `${uid}-sl-err` : undefined}
                    className={INPUT}
                  />
                </Field>
                <Field id={`${uid}-t1`} label="Target 1" error={errors.target1}>
                  <input
                    id={`${uid}-t1`}
                    inputMode="decimal"
                    value={t1}
                    placeholder={hint("resistance", prefill?.resistance ?? null)}
                    onChange={(e) => {
                      setT1(e.target.value);
                      clearErr("target1");
                    }}
                    aria-invalid={!!errors.target1}
                    aria-describedby={errors.target1 ? `${uid}-t1-err` : undefined}
                    className={INPUT}
                  />
                </Field>
                <Field id={`${uid}-t2`} label="Target 2" error={errors.target2}>
                  <input
                    id={`${uid}-t2`}
                    inputMode="decimal"
                    value={t2}
                    placeholder={hint("next resistance", prefill?.nextResistance ?? null)}
                    onChange={(e) => {
                      setT2(e.target.value);
                      clearErr("target2");
                    }}
                    aria-invalid={!!errors.target2}
                    aria-describedby={errors.target2 ? `${uid}-t2-err` : undefined}
                    className={INPUT}
                  />
                </Field>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={useSuggested}
                    disabled={!prefill || (prefill.support === null && prefill.resistance === null && prefill.nextResistance === null)}
                    className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)] hover:border-[var(--up)] hover:text-[var(--up)] disabled:opacity-50 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--muted)]"
                  >
                    Use suggested levels
                  </button>
                </div>
              </div>

              {incoming && (
                <p className="font-mono text-xs tabular-nums text-[var(--muted)]">
                  Invested {fmtInr(invested, 0)} · Value {fmtInr(value, 0)} · P/L{" "}
                  <span className={pnl === null ? "" : pctTone(pnl)}>
                    {fmtSignedInr(pnl, 0)}
                    {pnl !== null && invested ? ` (${fmtPct(pnl / invested)})` : ""}
                  </span>
                  {newAvg !== null && <> · New average {fmtInr(newAvg, 2)}</>}
                </p>
              )}

              {errors.key && <p role="alert" className="text-xs text-[var(--down)]">{errors.key}</p>}
              {formError && (
                <p role="alert" className="text-xs text-[var(--down)]">
                  {formError}
                </p>
              )}
              {warnings.length > 0 && (
                <ul className="flex flex-col gap-1 text-xs text-[var(--warn)]">
                  {warnings.map((w) => (
                    <li key={w}>⚠ {w}</li>
                  ))}
                </ul>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--text)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg border border-[var(--up)] bg-[color-mix(in_srgb,var(--up)_15%,transparent)] px-4 py-2 text-sm font-semibold text-[var(--up)] disabled:opacity-60"
                >
                  {saving ? "Saving…" : mode === "edit" ? "Save changes" : held ? "Add to holding" : "Save holding"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
