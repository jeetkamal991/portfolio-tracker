"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { fmtPrice } from "@/lib/view/dashboard";
import type { PopupData } from "@/lib/view/popup";
import { useQuotes } from "../QuotesProvider";
import { Chip, PctText } from "../ui";
import { ChartSetupTab } from "./ChartSetupTab";
import { DeepDiveTab } from "./DeepDiveTab";
import { IndicatorTab } from "./IndicatorTab";
import { PatternsTab } from "./PatternsTab";
import { ScoreBadge } from "./ScoreBadge";
import { closeStock, forgetPushedStock } from "./StockLink";

type TabId = "chart" | "deep" | "patterns" | "indicators";
type Loaded =
  | { key: string; status: "ready"; data: PopupData }
  | { key: string; status: "not_found" }
  | { key: string; status: "error" };

const WATCH_ERRORS: Record<string, string> = {
  unknown_symbol: "Symbol not found",
  no_data: "No price data for this stock",
  already_added: "Already on your watchlist",
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Skeleton() {
  const bar = "animate-pulse rounded bg-slate-800/70";
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className={`${bar} h-7 w-56`} />
        <div className={`${bar} h-5 w-12`} />
        <div className={`${bar} ml-auto h-16 w-40`} />
      </div>
      <div className={`${bar} h-8 w-full max-w-md`} />
      <div className={`${bar} h-[360px] w-full`} />
      <div className="grid gap-4 md:grid-cols-3">
        <div className={`${bar} h-48`} />
        <div className={`${bar} h-48`} />
        <div className={`${bar} h-48`} />
      </div>
    </div>
  );
}

function Header({ data, titleId, onWatchlist, onAdd, adding, addError, onClose }: {
  data: PopupData;
  titleId: string;
  onWatchlist: boolean;
  onAdd: () => void;
  adding: boolean;
  addError: string | null;
  onClose: () => void;
}) {
  const { quotes } = useQuotes();
  const q = quotes[data.instrument.yahooTicker];
  const cmp = q ? q.price : (data.latest?.close ?? null);
  const pct = q ? q.changePct : (data.latest?.pctChange ?? null);
  const isStock = data.instrument.type === "stock";
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 pr-10 sm:pr-0">
          <h2 id={titleId} className="text-xl font-extrabold tracking-tight sm:text-2xl">
            {data.instrument.name}
          </h2>
          <Chip tone="neutral">NSE</Chip>
          <span className="font-mono text-xs text-[var(--muted)]">{data.instrument.key}</span>
        </div>
        <div className="text-sm text-[var(--muted)]">
          {isStock ? (data.instrument.sectorName ?? "Sector not mapped") : data.instrument.type === "index" ? "Index" : "Sector index"}
        </div>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-2xl font-bold tabular-nums">{fmtPrice(cmp)}</span>
          <PctText value={pct} className="text-sm font-semibold" />
          {q && <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">live</span>}
        </div>
        {isStock && (
          <div className="flex flex-col gap-1">
            {onWatchlist ? (
              <span className="w-fit"><Chip tone="up">On watchlist</Chip></span>
            ) : (
              <button
                type="button"
                onClick={onAdd}
                disabled={adding}
                className="w-fit rounded-lg border border-[var(--border)] bg-slate-800 px-3 py-1.5 text-sm font-medium text-[var(--up)] hover:bg-slate-700 disabled:opacity-50"
              >
                {adding ? "Adding…" : "Add to Watchlist"}
              </button>
            )}
            {addError && <p role="alert" className="text-xs text-[var(--down)]">{addError}</p>}
          </div>
        )}
      </div>
      <div className="flex items-start gap-3">
        <ScoreBadge score={data.score?.value ?? null} label={data.score?.label ?? null} partial={data.score?.partial ?? false} size="sm" />
        <CloseButton onClose={onClose} className="hidden sm:inline-flex" />
      </div>
    </div>
  );
}

function CloseButton({ onClose, className = "" }: { onClose: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
     
      className={`h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-slate-800 hover:text-[var(--text)] ${className}`}
    >
      ✕
    </button>
  );
}

/** The single stock / sector / index pop-up, driven by `?stock=KEY`. */
export function StockModal() {
  const router = useRouter();
  const params = useSearchParams();
  const key = params?.get("stock") ?? null;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState<{ key: string | null; id: TabId }>({ key: null, id: "chart" });
  const [added, setAdded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<{ key: string; msg: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // History API, not router.replace: no server round-trip before the URL (and the dialog) updates.
  const close = closeStock;
  useEffect(() => {
    if (!key) forgetPushedStock(); // closed by browser Back or a navigation
  }, [key]);

  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/instrument/${encodeURIComponent(key)}`, { cache: "no-store", signal: ctrl.signal });
        if (res.status === 404) return setLoaded({ key, status: "not_found" });
        if (!res.ok) throw new Error(String(res.status));
        setLoaded({ key, status: "ready", data: (await res.json()) as PopupData });
      } catch {
        if (!ctrl.signal.aborted) setLoaded({ key, status: "error" });
      }
    })();
    return () => ctrl.abort();
  }, [key, reload]);

  // Esc closes, Tab cycles inside the dialog, page scroll is locked, focus returns on close.
  useEffect(() => {
    if (!key) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = dialogRef.current;
    const focusables = () =>
      root ? [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0) : [];
    root?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeStock();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const f = focusables();
      if (f.length === 0) {
        e.preventDefault();
        return;
      }
      const first = f[0]!;
      const last = f[f.length - 1]!;
      const active = document.activeElement;
      if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [key]);

  if (!key) return null;

  const current = loaded && loaded.key === key ? loaded : null;
  const activeTab: TabId = tab.key === key ? tab.id : "chart";

  async function addToWatchlist(k: string) {
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: k }),
      });
      if (res.ok) {
        setAdded(k);
        setReload((n) => n + 1); // re-read the pop-up: the stock now has history and a score
        router.refresh();
      } else {
        const body: { error?: string } = await res.json().catch(() => ({}));
        if (body.error === "already_added") setAdded(k);
        else setAddError({ key: k, msg: WATCH_ERRORS[body.error ?? ""] ?? "Could not add stock" });
      }
    } catch {
      setAddError({ key: k, msg: "Could not add stock" });
    } finally {
      setAdding(false);
    }
  }

  let body: ReactNode;
  if (!current) body = <Skeleton />;
  else if (current.status === "not_found") {
    body = (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <h2 id={titleId} className="text-lg font-semibold">Stock not found</h2>
        <p className="font-mono text-sm text-[var(--muted)]">No instrument with key {key}</p>
      </div>
    );
  } else if (current.status === "error") {
    body = (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <h2 id={titleId} className="text-lg font-semibold">Could not load {key}</h2>
        <button type="button" onClick={() => setReload((n) => n + 1)} className="text-sm text-[var(--up)] hover:underline">
          Try again
        </button>
      </div>
    );
  } else {
    const data = current.data;
    const hasHistory = data.days.some((d) => d.close !== null);
    const tabs: { id: TabId; label: string }[] = [
      { id: "chart", label: "Chart & Setup" },
      { id: "deep", label: "AI Deep Dive" },
      { id: "patterns", label: `Patterns (${data.patterns.length})` },
      { id: "indicators", label: "Indicator Table" },
    ];
    body = (
      <div className="flex flex-col gap-5">
        <Header
          data={data}
          titleId={titleId}
          onWatchlist={data.onWatchlist || added === key}
          onAdd={() => addToWatchlist(key)}
          adding={adding}
          addError={addError?.key === key ? addError.msg : null}
          onClose={close}
        />
        {!hasHistory ? (
          <p className="py-12 text-center text-sm text-[var(--muted)]">Not enough price history</p>
        ) : (
          <>
            <div role="tablist" aria-label="Stock views" className="-mx-1 flex gap-1 overflow-x-auto border-b border-[var(--border)] px-1 pb-2">
              {tabs.map((t) => {
                const on = t.id === activeTab;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setTab({ key, id: t.id })}
                    className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                      on
                        ? "border-[var(--border)] bg-slate-800 text-[var(--up)]"
                        : "border-transparent text-[var(--muted)] hover:bg-slate-800/50 hover:text-[var(--text)]"
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <div role="tabpanel" className="min-w-0">
              {activeTab === "chart" && <ChartSetupTab data={data} />}
              {activeTab === "deep" && (
                <DeepDiveTab stockKey={data.instrument.key} reports={data.reports} onRequested={() => setReload((n) => n + 1)} />
              )}
              {activeTab === "patterns" && <PatternsTab patterns={data.patterns} />}
              {activeTab === "indicators" && <IndicatorTab rows={data.indicatorTable} date={data.latest?.date ?? null} />}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/60 sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={current ? titleId : undefined}
        aria-label={current ? undefined : "Loading stock"}
        tabIndex={-1}
        className="relative mx-auto min-h-full w-full max-w-5xl bg-[var(--panel)] p-4 shadow-2xl outline-none sm:min-h-0 sm:rounded-xl sm:border sm:border-[var(--border)] sm:p-6"
      >
        {/* Phones: a fixed ✕ that stays reachable while scrolling; sm+: the ✕ sits in the header (here while loading). */}
        <CloseButton
          onClose={close}
          className={`fixed right-3 top-3 z-10 inline-flex bg-[var(--panel)] sm:absolute ${current?.status === "ready" ? "sm:hidden" : ""}`}
        />
        {body}
      </div>
    </div>
  );
}
