"use client";

import { useEffect, useState } from "react";
import { fmtDate, fmtPrice } from "@/lib/view/dashboard";
import { istClock, marketPhase, type MarketPhase } from "@/lib/view/shell";
import { Chip, PctText, type Tone } from "../ui";
import { useQuotes } from "../QuotesProvider";

export interface StripItem {
  ticker: string;
  name: string;
  /** Last stored close and day change (fraction); null when unknown. */
  close: number | null;
  pct: number | null;
}

const PHASE_TONE: Record<MarketPhase, Tone> = { OPEN: "up", "PRE-OPEN": "warn", CLOSED: "neutral" };
const CLOCK_MS = 30_000;

export function StatusStrip({
  items,
  asOf,
  initialNow,
}: {
  items: StripItem[];
  asOf: { date: string | null; stale: boolean };
  initialNow: string;
}) {
  const { quotes } = useQuotes();
  const [now, setNow] = useState(() => new Date(initialNow));
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(t);
  }, []);
  const phase = marketPhase(now);

  return (
    <div className="border-b border-[var(--border)] bg-[var(--panel-2)]">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 sm:px-6">
        <div className="flex items-center gap-2">
          <Chip tone={PHASE_TONE[phase]}>{phase}</Chip>
          <span className="font-mono text-xs tabular-nums text-[var(--muted)]">{istClock(now)}</span>
        </div>
        {items.map((it) => {
          const q = quotes[it.ticker]; // kept after close so the last live value stays visible
          const price = q ? q.price : it.close;
          const pct = q ? q.changePct : it.pct;
          return (
            <div key={it.ticker} className="flex items-baseline gap-2 font-mono text-xs tabular-nums">
              <span className="uppercase tracking-wider text-[var(--muted)]">{it.name}</span>
              <span className="text-[var(--text)]">{fmtPrice(price)}</span>
              <PctText value={pct} />
            </div>
          );
        })}
        <div className="ml-auto">
          <Chip
            tone={asOf.stale ? "warn" : "neutral"}
            title={asOf.stale ? "Data may be out of date: the last EOD update failed, is stuck, or has not run" : undefined}
          >
            {asOf.date ? `Data as of ${fmtDate(asOf.date)}` : "No data yet"}
            {asOf.stale ? " (stale)" : ""}
          </Chip>
        </div>
      </div>
    </div>
  );
}
