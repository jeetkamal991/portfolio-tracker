"use client";

import { useState } from "react";
import { ALPHAS } from "@/lib/calc/alpha/alphas";
import type { AlphaHit, AlphaResult } from "@/lib/calc/alpha/run";
import { fmtDate } from "@/lib/view/dashboard";
import { COLLAPSED_ROWS, fmtAlphaScore } from "@/lib/view/market";
import { StockLink } from "../popup/StockLink";
import { Chip, Label, Panel, PctText } from "../ui";

function HitList({ id, title, hits }: { id: AlphaResult["id"]; title: string; hits: AlphaHit[] }) {
  const [all, setAll] = useState(false);
  const rows = all ? hits : hits.slice(0, COLLAPSED_ROWS);
  if (hits.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{title}</Label>
      <ul className="flex flex-col gap-1.5">
        {rows.map((h) => (
          <li key={h.key} className="flex items-center gap-2">
            <StockLink stockKey={h.key} className="min-w-0 flex-1 truncate text-sm font-semibold">
              {h.name}
            </StockLink>
            <span className="whitespace-nowrap font-mono text-xs tabular-nums text-[var(--text)]">{fmtAlphaScore(id, h.score)}</span>
            <PctText value={h.dayPct} className="w-16 shrink-0 text-right text-xs" />
          </li>
        ))}
      </ul>
      {hits.length > COLLAPSED_ROWS && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="self-start font-mono text-xs text-[var(--up)] hover:underline"
        >
          {all ? "Show fewer" : `Show all ${hits.length}`}
        </button>
      )}
    </div>
  );
}

function AlphaCard({ r }: { r: AlphaResult }) {
  const def = ALPHAS.find((a) => a.id === r.id);
  const combined = r.id === "combined";
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{r.title}</h3>
        <Chip tone="neutral">{r.count}</Chip>
      </div>
      <p className="font-mono text-xs text-[var(--muted)]">
        {def ? `Alpha #${def.paperNo} · ${def.theme}` : "Mean rank across the six alphas, 0 to 100"}
      </p>
      {r.status === "unavailable" ? (
        <p className="text-sm text-[var(--muted)]">Unavailable today</p>
      ) : r.count === 0 ? (
        <p className="text-sm text-[var(--muted)]">Not enough history yet</p>
      ) : (
        <>
          <HitList id={r.id} title={combined ? "Highest rank" : "Highest"} hits={r.top} />
          <HitList id={r.id} title={combined ? "Lowest rank" : "Lowest"} hits={r.bottom} />
        </>
      )}
    </div>
  );
}

export function AlphaGrid({
  alphas,
  session,
  hasUniverse,
}: {
  alphas: AlphaResult[];
  session: string | null;
  hasUniverse: boolean;
}) {
  if (!hasUniverse || alphas.length === 0) return null;
  return (
    <Panel
      title="ALPHA RANKS · NIFTY 200"
      action={session ? <Label>as of {fmtDate(session).slice(0, 6)}</Label> : undefined}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {alphas.map((r) => (
          <AlphaCard key={r.id} r={r} />
        ))}
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Ranked by alpha: short-horizon statistical ranks, not a buy or sell call. Source: Kakushadze (2015), 101 Formulaic Alphas, arXiv:1601.00991.
      </p>
    </Panel>
  );
}
