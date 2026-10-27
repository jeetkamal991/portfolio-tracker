"use client";

import { useState } from "react";
import { caveats } from "@/lib/calc/backtest/caveats";
import type { Metrics } from "@/lib/calc/backtest/metrics";
import type { BacktestRun } from "@/lib/db/types";
import { fmtPrice, pctTone } from "@/lib/view/dashboard";
import { fmtFrac, fmtRatio, isDisplayable } from "@/lib/view/backtests";
import { StockLink } from "../popup/StockLink";
import { Chip, Label, Panel, PctText } from "../ui";
import { EquityCurve } from "./EquityCurve";

const TRADE_ROWS = 10;

interface Card {
  label: string;
  strategy: string;
  benchmark: string | null;
  tone?: string;
}

function cards(s: Metrics, b: Metrics): Card[] {
  const plain = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
  return [
    { label: "CAGR", strategy: fmtFrac(s.cagr), benchmark: fmtFrac(b.cagr), tone: pctTone(s.cagr) },
    { label: "Total return", strategy: fmtFrac(s.totalReturn), benchmark: fmtFrac(b.totalReturn), tone: pctTone(s.totalReturn) },
    { label: "Max drawdown", strategy: fmtFrac(s.maxDrawdown), benchmark: fmtFrac(b.maxDrawdown) },
    { label: "Volatility", strategy: plain(s.volatility), benchmark: plain(b.volatility) },
    { label: "Sharpe (risk-free 0)", strategy: fmtRatio(s.sharpe), benchmark: fmtRatio(b.sharpe) },
    { label: "Hit rate", strategy: plain(s.hitRate), benchmark: null },
    { label: "Avg win", strategy: fmtFrac(s.avgWinPct), benchmark: null },
    { label: "Avg loss", strategy: fmtFrac(s.avgLossPct), benchmark: null },
    { label: "Trades", strategy: String(s.trades), benchmark: null },
    { label: "Turnover per year", strategy: s.turnoverPerYear === null ? "—" : `${s.turnoverPerYear.toFixed(1)}×`, benchmark: null },
    { label: "Time invested", strategy: plain(s.timeInvested), benchmark: null },
  ];
}

function Trades({ trades }: { trades: BacktestRun["trades"] }) {
  const [all, setAll] = useState(false);
  if (trades.length === 0) return <p className="text-sm text-[var(--muted)]">No trades in this run.</p>;
  const sorted = [...trades].sort((a, b) => (a.exitDate < b.exitDate ? 1 : a.exitDate > b.exitDate ? -1 : a.key < b.key ? -1 : 1));
  const rows = all ? sorted : sorted.slice(0, TRADE_ROWS);
  const th = "whitespace-nowrap px-2 py-1.5 text-left font-mono text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]";
  const td = "whitespace-nowrap px-2 py-1.5 font-mono text-xs tabular-nums";
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={th}>Stock</th>
              <th className={th}>Entry</th>
              <th className={th}>Exit</th>
              <th className={`${th} text-right`}>Entry px</th>
              <th className={`${th} text-right`}>Exit px</th>
              <th className={`${th} text-right`}>P/L</th>
              <th className={th}>Exit reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={`${t.key}-${t.entryDate}-${i}`} className="border-b border-[var(--border)] last:border-0">
                <td className="px-2 py-1.5">
                  <StockLink stockKey={t.key} className="text-sm font-semibold">{t.name}</StockLink>
                </td>
                <td className={`${td} text-[var(--muted)]`}>{t.entryDate}</td>
                <td className={`${td} text-[var(--muted)]`}>{t.exitDate}</td>
                <td className={`${td} text-right`}>{fmtPrice(t.entryPrice)}</td>
                <td className={`${td} text-right`}>{fmtPrice(t.exitPrice)}</td>
                <td className={`${td} text-right`}><PctText value={t.pnlPct} /></td>
                <td className="flex gap-1 px-2 py-1.5">
                  <Chip tone={t.reason === "stop" ? "warn" : t.reason === "delisted" ? "down" : "neutral"}>{t.reason}</Chip>
                  {t.suspect && <Chip tone="warn" title="This trade spans a daily move of 35% or more: possibly an unadjusted split">check data</Chip>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {trades.length > TRADE_ROWS && (
        <button type="button" onClick={() => setAll((v) => !v)} className="self-start font-mono text-xs text-[var(--up)] hover:underline">
          {all ? "Show fewer" : `Show all ${trades.length}`}
        </button>
      )}
    </div>
  );
}

export function RunDetail({ run }: { run: BacktestRun }) {
  if (!isDisplayable(run)) {
    return (
      <Panel title="BACKTEST">
        <p className="text-sm text-[var(--warn)]">Can&apos;t display this run: its saved data is incomplete.</p>
      </Panel>
    );
  }
  const s = run.settings;
  return (
    <div className="flex flex-col gap-4">
      <Panel title={run.name.toUpperCase()}>
        <p className="font-mono text-xs text-[var(--muted)]">
          {run.strategy.label} · {s.from} to {s.to} · up to {s.maxPositions} positions · hold {s.holdSessions} sessions
          {s.stopPct === null ? "" : ` · stop ${s.stopPct}%`} · capital {s.capital.toLocaleString("en-IN")}
        </p>
      </Panel>
      <Panel className="border-[color-mix(in_srgb,var(--warn)_40%,transparent)]">
        <Label>Read with care</Label>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-[var(--warn)]">
          {caveats(run.strategy.id).map((c) => <li key={c}>{c}</li>)}
        </ul>
        <p className="mt-2 font-mono text-xs text-[var(--muted)]">{run.universeNote} Data through {run.dataThrough}.</p>
      </Panel>
      <Panel title="STRATEGY VS NIFTY 50">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {cards(run.metrics.strategy, run.metrics.benchmark).map((c) => (
            <div key={c.label} className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
              <Label>{c.label}</Label>
              <div className={`mt-1 font-mono text-lg font-semibold tabular-nums ${c.tone ?? ""}`}>{c.strategy}</div>
              {c.benchmark !== null && <div className="font-mono text-xs text-[var(--muted)]">Nifty 50 {c.benchmark}</div>}
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="EQUITY CURVE">
        <EquityCurve equity={run.equity} />
      </Panel>
      <Panel title="TRADES">
        <Trades trades={run.trades} />
      </Panel>
    </div>
  );
}
