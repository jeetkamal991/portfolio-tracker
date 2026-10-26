"use client";

import { useState } from "react";
import type { StakeScreener } from "@/lib/calc/shareholding";
import { COLLAPSED_ROWS } from "@/lib/view/market";
import { StockLink } from "../popup/StockLink";
import { Chip, Panel } from "../ui";

function StakeCard({ s }: { s: StakeScreener }) {
  const [all, setAll] = useState(false);
  const rows = all ? s.hits : s.hits.slice(0, COLLAPSED_ROWS);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{s.holder} increased stake</h3>
        <Chip tone="neutral">{s.hits.length}</Chip>
      </div>
      <p className="font-mono text-xs text-[var(--muted)]">
        {s.label} · {s.reported} / {s.total} reported
      </p>
      {s.hits.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No stake increases reported yet this quarter.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((h) => (
            <li key={h.key} className="flex items-center gap-2">
              <StockLink stockKey={h.key} className="min-w-0 flex-1 truncate text-sm font-semibold">
                {h.name}
              </StockLink>
              <span className="whitespace-nowrap font-mono text-xs tabular-nums">{h.from}% → {h.to}%</span>
              <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-[var(--up)]">+{h.change.toFixed(1)} pts</span>
            </li>
          ))}
        </ul>
      )}
      {s.hits.length > COLLAPSED_ROWS && (
        <button type="button" onClick={() => setAll((v) => !v)} className="self-start font-mono text-xs text-[var(--up)] hover:underline">
          {all ? "Show fewer" : `Show all ${s.hits.length}`}
        </button>
      )}
    </div>
  );
}

export function StakeScreeners({ stakes }: { stakes: { fii: StakeScreener; dii: StakeScreener } | null }) {
  return (
    <Panel title="STAKE CHANGES · NIFTY 200 · QUARTERLY">
      {!stakes ? (
        <p className="text-sm text-[var(--muted)]">Shareholding data appears after the quarterly update runs.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <StakeCard s={stakes.fii} />
          <StakeCard s={stakes.dii} />
        </div>
      )}
    </Panel>
  );
}
