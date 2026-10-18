"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Holding, StoredDay } from "@/lib/db/types";
import { fmtPct, pctTone } from "@/lib/view/dashboard";
import { buildPortfolioView, fmtInr, fmtSignedInr, sortPortfolioRows } from "@/lib/view/portfolio";
import { useQuotes } from "../QuotesProvider";
import { StockLink } from "../popup/StockLink";
import { Chip, Label, Panel } from "../ui";

const TOP = 4;

function Mini({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

const BIG = "mt-1 truncate font-mono text-lg font-semibold tabular-nums";

/** Dashboard summary of the Portfolio tab; same view model, so the totals match it. */
export function PortfolioSnapshot({
  holdings,
  latest,
  today,
}: {
  holdings: Holding[];
  latest: [number, StoredDay | null][];
  today: string;
}) {
  const { quotes, open } = useQuotes();
  const { rows, totals } = buildPortfolioView(holdings, new Map(latest), quotes, today);
  const priced = totals.count - totals.unpriced > 0;
  const pnlTone = priced ? pctTone(totals.pnl) : "text-[var(--muted)]";
  const todayTone = priced ? pctTone(totals.todayPnl) : "text-[var(--muted)]";
  const top = sortPortfolioRows(rows, "value", "desc").slice(0, TOP);

  return (
    <Panel
      title="YOUR PORTFOLIO"
      action={
        holdings.length > 0 && (
          <Link href="/portfolio" className="font-mono text-xs text-[var(--up)] hover:underline">
            Manage portfolio ({holdings.length}) →
          </Link>
        )
      }
    >
      {holdings.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-[var(--muted)]">Track your holdings, P/L and stop-loss alerts here.</p>
          <Link
            href="/portfolio?add=1"
            className="rounded-lg border border-[var(--border)] bg-slate-800 px-3 py-1.5 text-sm font-medium text-[var(--up)] hover:bg-slate-700"
          >
            Add your first holding
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Mini label="Invested">
              <div className={BIG}>{priced ? fmtInr(totals.invested, 0) : "—"}</div>
            </Mini>
            <Mini label="Current value">
              <div className={BIG}>{priced ? fmtInr(totals.value, 0) : "—"}</div>
            </Mini>
            <Mini label="Overall P/L">
              <div className={`${BIG} ${pnlTone}`}>{priced ? fmtSignedInr(totals.pnl, 0) : "—"}</div>
              <div className={`font-mono text-xs tabular-nums ${pnlTone}`}>{priced ? fmtPct(totals.pnlPct) : "—"}</div>
            </Mini>
            <Mini
              label={
                <span className="inline-flex items-center gap-2">
                  Today&apos;s P/L
                  {open && priced && <Chip tone="up">LIVE</Chip>}
                </span>
              }
            >
              <div className={`${BIG} ${todayTone}`}>{priced ? fmtSignedInr(totals.todayPnl, 0) : "—"}</div>
            </Mini>
          </div>
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {top.map((r) => (
              <li key={r.key} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-1 flex-col">
                  <StockLink stockKey={r.key} className="truncate text-sm font-semibold">
                    {r.name}
                  </StockLink>
                  <span className="truncate font-mono text-xs tabular-nums text-[var(--muted)]">
                    {r.qty} shares · Buy {fmtInr(r.avgPrice)} · CMP {fmtInr(r.cmp)}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end font-mono tabular-nums">
                  <span className={`text-sm font-semibold ${pctTone(r.pnl)}`}>{fmtSignedInr(r.pnl, 0)}</span>
                  <span className={`text-xs ${pctTone(r.pnlPct)}`}>{fmtPct(r.pnlPct)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
