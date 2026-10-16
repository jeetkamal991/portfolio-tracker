"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { isMarketOpen } from "@/lib/time/ist";

export interface LiveQuote { ticker: string; price: number; changePct: number }
interface QuotesState { quotes: Record<string, LiveQuote>; open: boolean }

const QuotesContext = createContext<QuotesState>({ quotes: {}, open: false });
export const useQuotes = (): QuotesState => useContext(QuotesContext);

const POLL_MS = 60_000;

/**
 * Single 60 s poller of /api/quotes shared by the live strip and the watchlist.
 * The open/closed check is re-evaluated on every tick, so a page opened before 09:15 IST
 * starts fetching once the market opens. After close the last live quotes are kept.
 */
export function QuotesProvider({ initialOpen, children }: { initialOpen: boolean; children: ReactNode }) {
  const [state, setState] = useState<QuotesState>({ quotes: {}, open: initialOpen });

  useEffect(() => {
    let stopped = false;
    const fetchQuotes = async () => {
      try {
        const res = await fetch("/api/quotes", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data: { quotes: LiveQuote[]; marketOpen: boolean } = await res.json();
        if (stopped) return;
        setState((s) => ({
          open: data.marketOpen,
          quotes: { ...s.quotes, ...Object.fromEntries(data.quotes.map((q) => [q.ticker, q])) },
        }));
      } catch {
        // keep the last known values; retry on the next tick
      }
    };
    const tick = () => {
      if (isMarketOpen(new Date())) void fetchQuotes();
      else setState((s) => (s.open ? { ...s, open: false } : s));
    };
    if (initialOpen) void fetchQuotes();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [initialOpen]);

  return <QuotesContext.Provider value={state}>{children}</QuotesContext.Provider>;
}
