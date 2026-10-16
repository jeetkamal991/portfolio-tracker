"use client";

import { fmtPct, fmtPrice, pctTone } from "@/lib/view/dashboard";
import { useQuotes } from "./QuotesProvider";

export interface StripItem {
  ticker: string;
  name: string;
  /** Last close and day change (fraction) from the server; null when unknown. */
  close: number | null;
  pct: number | null;
}

/** Indices followed by watchlist stocks; live quotes come from the shared QuotesProvider. */
export function LiveStrip({ items }: { items: StripItem[] }) {
  const { quotes, open } = useQuotes();
  return (
    <section aria-label="Live indices and watchlist" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {items.map((it) => {
        const q = quotes[it.ticker]; // kept after close so the last live value stays visible
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
