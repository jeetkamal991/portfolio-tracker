"use client";

import { useState } from "react";
import { ACTIVE_TOP, MIN_PCT, type DeliveryView } from "@/lib/calc/delivery";
import { fmtDate } from "@/lib/view/dashboard";
import { COLLAPSED_ROWS } from "@/lib/view/market";
import { StockLink } from "../popup/StockLink";
import { Chip } from "../ui";

const CARD = "flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4";

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

function MoreButton({ open, hidden, onClick }: { open: boolean; hidden: number; onClick: () => void }) {
  if (hidden <= 0) return null;
  return (
    <button type="button" onClick={onClick} className="self-start font-mono text-xs text-[var(--up)] hover:underline">
      {open ? "Read less" : `Read more (${hidden} more)`}
    </button>
  );
}

function Empty({ view }: { view: DeliveryView }) {
  return (
    <p className="text-sm text-[var(--muted)]">
      {view.session ? "Nothing to show yet." : "Delivery data appears after the first nightly import (run `npm run backfill-delivery`)."}
    </p>
  );
}

/** Today's stocks at 60%+ delivery among the 100 most traded by value. */
export function TodayDeliveryCard({ view, names }: { view: DeliveryView; names: Record<string, string> }) {
  const [all, setAll] = useState(false);
  const rows = all ? view.today : view.today.slice(0, COLLAPSED_ROWS);
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">High delivery today · {MIN_PCT}%+</h3>
        <Chip tone="neutral">{view.today.length}</Chip>
      </div>
      <p className="font-mono text-xs text-[var(--muted)]">
        NSE · {view.session ? fmtDate(view.session).slice(0, 6) : "no data"} · among the 100 most traded by value
      </p>
      {!view.session ? (
        <Empty view={view} />
      ) : view.today.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No stock crossed {MIN_PCT}% today.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((t) => (
            <li key={t.symbol} className="flex items-center gap-2">
              <Sym symbol={t.symbol} names={names} />
              <span className="whitespace-nowrap font-mono text-xs tabular-nums text-[var(--muted)]">#{t.rank} · ₹{t.turnoverCr.toLocaleString("en-IN")} Cr</span>
              <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-[var(--up)]">{t.delivPer}%</span>
            </li>
          ))}
        </ul>
      )}
      <MoreButton open={all} hidden={view.today.length - COLLAPSED_ROWS} onClick={() => setAll((v) => !v)} />
    </div>
  );
}

/** Stocks that keep showing up on the most-active list with 60%+ delivery, with a 10D / 20D switch. */
export function RepeatDeliveryCard({ view, names }: { view: DeliveryView; names: Record<string, string> }) {
  const [win, setWin] = useState(view.shortlists.length - 1);
  const sl = view.shortlists[win]!;
  const [all, setAll] = useState(false);
  const rows = all ? sl.hits : sl.hits.slice(0, COLLAPSED_ROWS);
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Repeat names · {sl.days} sessions</h3>
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
      </div>
      <p className="font-mono text-xs text-[var(--muted)]">
        Top {ACTIVE_TOP} by value and {MIN_PCT}%+ delivery on {sl.minDays}+ days
        {sl.available < sl.days ? ` · only ${sl.available} sessions stored` : ""}
      </p>
      {!view.session ? (
        <Empty view={view} />
      ) : sl.hits.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No stock has qualified on {sl.minDays} of the last {sl.days} sessions.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((h) => {
            const up = h.latestPer !== null && h.latestPer >= h.avgPer;
            return (
              <li key={h.symbol} className="flex items-center gap-2">
                <Sym symbol={h.symbol} names={names} />
                <span className="whitespace-nowrap font-mono text-xs tabular-nums text-[var(--muted)]">{h.days}/{sl.days}</span>
                <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-[var(--up)]">
                  avg {h.avgPer}%{h.latestPer !== null && <span className={up ? "text-[var(--up)]" : "text-[var(--down)]"}> {up ? "↑" : "↓"}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <MoreButton open={all} hidden={sl.hits.length - COLLAPSED_ROWS} onClick={() => setAll((v) => !v)} />
    </div>
  );
}
