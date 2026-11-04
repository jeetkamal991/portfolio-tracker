"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MARKET_VIEWS, type MarketView } from "@/lib/view/marketViews";

const EVENT = "market:view";

/** A button anywhere on the page that switches the board to another view. */
export function ViewLink({ view, children, className = "" }: { view: MarketView; children: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(EVENT, { detail: view }))} className={`font-mono text-xs text-[var(--up)] hover:underline ${className}`}>
      {children}
    </button>
  );
}

/**
 * One view at a time under the important cards. The choice lives in `?v=` (set with the History API, so
 * switching never asks the server for anything) and `views` are rendered on the server and passed in.
 */
export function MarketBoard({
  initial,
  views,
  counts,
}: {
  initial: MarketView;
  views: Record<MarketView, ReactNode>;
  counts: Partial<Record<MarketView, number>>;
}) {
  const [view, setView] = useState<MarketView>(initial);

  const select = (next: MarketView) => {
    setView(next);
    const params = new URLSearchParams(window.location.search);
    params.set("v", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  };

  useEffect(() => {
    const on = (e: Event) => {
      const next = (e as CustomEvent<MarketView>).detail;
      if (MARKET_VIEWS.some((m) => m.id === next)) select(next);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Market views" className="flex flex-wrap gap-2">
        {MARKET_VIEWS.map((m) => {
          const on = m.id === view;
          const n = counts[m.id];
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              id={`market-tab-${m.id}`}
              aria-selected={on}
              aria-controls="market-panel"
              onClick={() => select(m.id)}
              className={`rounded-lg border px-3.5 py-2 text-sm font-semibold ${
                on
                  ? "border-[var(--text)] bg-[var(--text)] text-[var(--bg)]"
                  : "border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {m.label}
              {n !== undefined && <span className={`ml-2 font-mono text-xs ${on ? "" : "text-[var(--muted)]"}`}>{n}</span>}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id="market-panel" aria-labelledby={`market-tab-${view}`} className="min-w-0">
        {views[view]}
      </div>
    </div>
  );
}
