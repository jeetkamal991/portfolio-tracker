"use client";

import { useEffect, useState } from "react";

export interface PickHit { key: string; name: string }
interface Hit extends PickHit { type?: string }

/** Debounced stock search, styled like the watchlist's AddStock. Stocks only, unless `scope="all"` (indices and sectors too). */
export function StockPicker({
  onPick,
  autoFocus = false,
  scope = "stocks",
}: {
  onPick: (hit: PickHit) => void;
  autoFocus?: boolean;
  scope?: "stocks" | "all";
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const all = scope === "all";
        const res = await fetch(`/api/instruments/search?q=${encodeURIComponent(term)}${all ? "&scope=all" : ""}`, { signal: ctrl.signal });
        if (res.ok) setHits(((await res.json()) as Hit[]).filter((h) => all || h.type === undefined || h.type === "stock"));
      } catch {
        // aborted or offline: leave the previous hits
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, scope]);

  return (
    <div className="relative">
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--muted)]"
        aria-hidden
      >
        <circle cx="9" cy="9" r="6" />
        <path d="m14 14 4 4" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={scope === "all" ? "Search a stock or index — name or symbol" : "Search a stock — name or symbol"}
        aria-label="Search stock"
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] py-2 pl-9 pr-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--up)] focus:outline-none"
      />
      {hits.length > 0 && (
        // In the page flow, not absolute: the form's dialog scrolls, so an overlay would be clipped by it.
        <ul className="mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] text-sm shadow-lg">
          {hits.map((h) => (
            <li key={h.key}>
              <button type="button" onClick={() => onPick(h)} className="w-full px-3 py-2 text-left hover:bg-slate-800/60">
                {h.name} <span className="font-mono text-xs text-[var(--muted)]">({h.key})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
