"use client";

import { useEffect, useState } from "react";
import { fmtPct, fmtPrice, pctTone } from "@/lib/view/dashboard";

export interface StripItem {
  ticker: string;
  name: string;
  /** Last close and day change (fraction) from the server; null when unknown. */
  close: number | null;
  pct: number | null;
}
interface LiveQuote { ticker: string; price: number; changePct: number }

export function LiveStrip({ items, marketOpen: initialOpen }: { items: StripItem[]; marketOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch("/api/quotes", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data: { quotes: LiveQuote[]; marketOpen: boolean } = await res.json();
        if (stopped) return;
        setOpen(data.marketOpen);
        setQuotes(Object.fromEntries(data.quotes.map((q) => [q.ticker, q])));
        if (!data.marketOpen) return; // stop polling once the market has closed
      } catch {
        // keep showing the last known values; retry on the next tick
      }
      if (!stopped) timer = setTimeout(tick, 60_000);
    };
    if (initialOpen) tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [initialOpen]);

  return (
    <section aria-label="Live indices" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {items.map((it) => {
        const q = open ? quotes[it.ticker] : undefined;
        const price = q ? q.price : it.close;
        const pct = q ? q.changePct : it.pct;
        return (
          <div key={it.ticker} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span>{it.name}</span>
              <span>{open ? "Live" : "Closed"}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-xl font-semibold tabular-nums">{fmtPrice(price)}</span>
              <span className={`text-sm font-medium tabular-nums ${pctTone(pct)}`}>{fmtPct(pct)}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
