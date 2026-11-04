"use client";

import { useState } from "react";
import { ACTIVE_TOP, MIN_PCT, type DeliveryView } from "@/lib/calc/delivery";
import { fmtDate } from "@/lib/view/dashboard";
import { StockLink } from "../popup/StockLink";
import { Chip, Panel } from "../ui";

/** `names` has an entry only for symbols that exist as instruments, so only those open a pop-up. */
function Sym({ symbol, names }: { symbol: string; names: Record<string, string> }) {
  const name = names[symbol];
  return name ? (
    <StockLink stockKey={symbol} className="min-w-0 flex-1 truncate text-sm font-semibold">
      {name}
    </StockLink>
  ) : (
    <span className="min-w-0 flex-1 truncate text-sm font-semibold" title="Not tracked in this app, so no pop-up">
      {symbol}
    </span>
  );
}

export function DeliveryPanel({ view, names }: { view: DeliveryView; names: Record<string, string> }) {
  const [win, setWin] = useState(0);
  const sl = view.shortlists[win]!;

  return (
    <Panel
      title="HIGH DELIVERY · NSE"
      action={
        <span className="flex items-center gap-2">
          {view.session && <span className="font-mono text-xs text-[var(--muted)]">{fmtDate(view.session)}</span>}
          <span role="group" aria-label="Monitoring window" className="flex gap-1">
            {view.shortlists.map((s, i) => (
              <button
                key={s.days}
                type="button"
                onClick={() => setWin(i)}
                aria-pressed={win === i}
                className={`rounded-md border px-2 py-0.5 font-mono text-xs ${win === i ? "border-[var(--up)] text-[var(--up)]" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"}`}
              >
                {s.days}D
              </button>
            ))}
          </span>
        </span>
      }
    >
      {!view.session ? (
        <p className="text-sm text-[var(--muted)]">Delivery data appears after the first nightly import (run `npm run backfill-delivery`).</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Today · {MIN_PCT}%+ delivery</h3>
              <Chip tone="neutral">{view.today.length}</Chip>
            </div>
            <p className="font-mono text-xs text-[var(--muted)]">Among the 100 most traded by value</p>
            {view.today.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No stock crossed {MIN_PCT}% today.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {view.today.map((t) => (
                  <li key={t.symbol} className="flex items-center gap-2">
                    <Sym symbol={t.symbol} names={names} />
                    <span className="whitespace-nowrap font-mono text-xs tabular-nums text-[var(--muted)]">#{t.rank} · ₹{t.turnoverCr.toLocaleString("en-IN")} Cr</span>
                    <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-[var(--up)]">{t.delivPer}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Repeat names · {sl.days} sessions</h3>
              <Chip tone="neutral">{sl.hits.length}</Chip>
            </div>
            <p className="font-mono text-xs text-[var(--muted)]">
              Top {ACTIVE_TOP} by value and {MIN_PCT}%+ delivery on {sl.minDays}+ days
              {sl.available < sl.days ? ` · only ${sl.available} sessions stored` : ""}
            </p>
            {sl.hits.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No stock has qualified on {sl.minDays} of the last {sl.days} sessions.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {sl.hits.map((h) => {
                  const up = h.latestPer !== null && h.latestPer >= h.avgPer;
                  return (
                    <li key={h.symbol} className="flex items-center gap-2">
                      <Sym symbol={h.symbol} names={names} />
                      <span className="whitespace-nowrap font-mono text-xs tabular-nums text-[var(--muted)]">{h.days}/{sl.days} days</span>
                      <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-[var(--up)]">
                        avg {h.avgPer}%{h.latestPer !== null && <span className={up ? "text-[var(--up)]" : "text-[var(--down)]"}> {up ? "↑" : "↓"}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
