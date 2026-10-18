"use client";

import { useEffect, useState } from "react";
import type { MoversResponse } from "@/lib/api/movers";
import { fmtPrice } from "@/lib/view/dashboard";
import { moversLabel, type MoverEntry, type Movers } from "@/lib/view/movers";
import { BreadthBar } from "../BreadthBar";
import { StockLink } from "../popup/StockLink";
import { useQuotes } from "../QuotesProvider";
import { Chip, Label, Panel, PctText } from "../ui";

const POLL_MS = 60_000;

/** Nifty 200 top gainers/losers and breadth; refetches every 60 s while the market is open. */
export function MoversPanel({ initial }: { initial: MoversResponse }) {
  const { open } = useQuotes();
  const [data, setData] = useState(initial);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/movers", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next: MoversResponse = await res.json();
        if (!stopped) setData(next);
      } catch {
        // keep the last data; retry on the next tick
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [open]);

  const label = moversLabel(data, open);
  const action = !label ? null : label.kind === "live" ? (
    <Chip tone="up">LIVE</Chip>
  ) : (
    <span className="whitespace-nowrap">
      <Label>{label.text}</Label>
    </span>
  );

  return (
    <Panel title="MARKET MOVERS · NIFTY 200" action={action}>
      {data.state === "no_universe" ? (
        <p className="text-sm text-[var(--muted)]">Market movers appear after the Nifty 200 list is imported.</p>
      ) : data.state === "no_data" ? (
        <p className="text-sm text-[var(--muted)]">No session data yet.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <MoverList title="TOP GAINERS" rows={data.movers.gainers} tone="up" />
            <MoverList title="TOP LOSERS" rows={data.movers.losers} tone="down" />
          </div>
          <Breadth breadth={data.movers.breadth} />
        </div>
      )}
    </Panel>
  );
}

function MoverList({ title, rows, tone }: { title: string; rows: MoverEntry[]; tone: "up" | "down" }) {
  const max = Math.max(0, ...rows.map((r) => Math.abs(r.pct ?? 0)));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label>{title}</Label>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">None today.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-3">
                <StockLink stockKey={r.key} className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {r.name}
                </StockLink>
                <span className="font-mono text-sm tabular-nums text-[var(--text)]">{fmtPrice(r.price)}</span>
                <PctText value={r.pct} className="w-16 text-right text-sm" />
              </div>
              <div className="h-1 rounded-full bg-[var(--panel-2)]">
                <div
                  className="h-1 rounded-full"
                  style={{
                    width: `${max > 0 ? (Math.abs(r.pct ?? 0) / max) * 100 : 0}%`,
                    background: `var(--${tone})`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Breadth({ breadth }: { breadth: Movers["breadth"] }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>BREADTH</Label>
      <BreadthBar breadth={breadth} />
    </div>
  );
}
