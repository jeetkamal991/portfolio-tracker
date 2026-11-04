"use client";

import { useState } from "react";
import type { SignalBias, WatchSignal, WatchSignals } from "@/lib/calc/watchSignals";
import { COLLAPSED_ROWS, fmtShortDate } from "@/lib/view/market";
import { StockLink } from "../popup/StockLink";
import { Chip, Panel, type Tone } from "../ui";

const BIAS: Record<SignalBias, Tone> = { bullish: "up", bearish: "down", neutral: "neutral" };
const BIAS_TEXT: Record<SignalBias, string> = { bullish: "Bullish", bearish: "Bearish", neutral: "Neutral" };

function SignalBox({ title, items, empty }: { title: string; items: WatchSignal[]; empty: string }) {
  const [all, setAll] = useState(false);
  const rows = all ? items : items.slice(0, COLLAPSED_ROWS);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Chip tone="neutral">{items.length}</Chip>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((s, i) => (
            <li key={`${s.key}-${s.date}-${s.label}-${i}`} className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <StockLink stockKey={s.key} className="truncate text-sm font-semibold">
                  {s.name}
                </StockLink>
                <span className="truncate text-xs text-[var(--muted)]">{s.label}</span>
              </div>
              <Chip tone={BIAS[s.bias]}>{BIAS_TEXT[s.bias]}</Chip>
              <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-[var(--muted)]">
                {fmtShortDate(s.date)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {items.length > COLLAPSED_ROWS && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="self-start font-mono text-xs text-[var(--up)] hover:underline"
        >
          {all ? "Read less" : `Read more (${items.length - COLLAPSED_ROWS} more)`}
        </button>
      )}
    </div>
  );
}

export function WatchSignalsPanel({ signals, hasWatchStocks }: { signals: WatchSignals; hasWatchStocks: boolean }) {
  return (
    <Panel title="YOUR STOCKS · SIGNALS" action={<span className="text-xs text-[var(--muted)]">last 5 sessions</span>}>
      {!hasWatchStocks ? (
        <p className="text-sm text-[var(--muted)]">Add stocks to your watchlist to see signals here.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SignalBox title="Crosses" items={signals.crosses} empty="No crosses on your stocks in the last 5 sessions" />
          <SignalBox
            title="Formations"
            items={signals.formations}
            empty="No candle patterns on your stocks in the last 5 sessions"
          />
        </div>
      )}
    </Panel>
  );
}
