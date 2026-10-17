"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Levels, StoredDay } from "@/lib/db/types";
import {
  buildWatchlistRow,
  fmtPct,
  fmtPrice,
  parseLevelInput,
  pctTone,
  type WatchlistRow,
} from "@/lib/view/dashboard";
import { useQuotes } from "./QuotesProvider";
import { Panel } from "./ui";

export interface WatchItem {
  key: string;
  name: string;
  ticker: string;
  lastDay: StoredDay;
  levels: Levels;
}

const TREND_LABEL = { above_both: "Above both", between: "Between", below_both: "Below both" } as const;
type Side = "support" | "resistance";

export function WatchlistTable({ items }: { items: WatchItem[] }) {
  const router = useRouter();
  const { quotes } = useQuotes();
  const [editing, setEditing] = useState<{ key: string; side: Side } | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rows: WatchlistRow[] = items.map((it) => {
    const q = quotes[it.ticker];
    return buildWatchlistRow(
      { key: it.key, name: it.name, lastDay: it.lastDay, levels: it.levels },
      q ? q.price : (it.lastDay.close as number),
      q ? q.changePct : null,
    );
  });

  async function saveLevel(row: WatchlistRow, side: Side) {
    const parsed = parseLevelInput(draft);
    if (!parsed.ok) {
      setError("Enter a positive number, or leave empty to clear");
      return;
    }
    const levels = items.find((i) => i.key === row.key)!.levels;
    const body = {
      manualSupport: side === "support" ? parsed.value : levels.manualSupport,
      manualResistance: side === "resistance" ? parsed.value : levels.manualResistance,
    };
    try {
      const res = await fetch(`/api/levels/${encodeURIComponent(row.key)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      setEditing(null);
      setError(null);
      router.refresh();
    } catch {
      setError("Could not save level");
    }
  }

  async function remove(key: string) {
    try {
      const res = await fetch(`/api/watchlist/${encodeURIComponent(key)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setError("Could not remove stock");
    }
  }

  function levelCell(row: WatchlistRow, side: Side) {
    const value = side === "support" ? row.support : row.resistance;
    const manual = side === "support" ? row.supportIsManual : row.resistanceIsManual;
    const dist = side === "support" ? row.toSupport : row.toResistance;
    if (editing?.key === row.key && editing.side === side) {
      return (
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void saveLevel(row, side);
            if (e.key === "Escape") {
              setEditing(null);
              setError(null);
            }
          }}
          onBlur={() => {
            setEditing(null);
            setError(null);
          }}
          aria-label={`Manual ${side} for ${row.name}`}
          className="w-20 rounded border border-[var(--border)] bg-[var(--panel-2)] px-1 text-right font-mono tabular-nums focus:border-[var(--up)] focus:outline-none"
        />
      );
    }
    return (
      <button
        type="button"
        title="Click to set a manual level (empty clears)"
        onClick={() => {
          setEditing({ key: row.key, side });
          setDraft(manual && value !== null ? String(value) : "");
          setError(null);
        }}
        className="font-mono tabular-nums hover:underline"
      >
        {manual && <span className="mr-1 rounded border border-amber-400/40 bg-amber-950/70 px-1 text-[10px] font-semibold text-[var(--warn)]">M</span>}
        {fmtPrice(value)}
        <span className="ml-1 text-xs text-[var(--muted)]">{fmtPct(dist)}</span>
      </button>
    );
  }

  return (
    <Panel title="Watchlist">
      {error && (
        <p role="alert" className="mb-2 text-xs text-[var(--down)]">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No stocks yet. Add one above.</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
              <tr className="text-right">
                <th className="py-1 text-left font-medium">Stock</th>
                <th className="px-2 font-medium">CMP</th>
                <th className="px-2 font-medium">Day %</th>
                <th className="px-2 font-medium">EMA 50</th>
                <th className="px-2 font-medium">EMA 200</th>
                <th className="px-2 font-medium">Trend</th>
                <th className="px-2 font-medium">Support</th>
                <th className="px-2 font-medium">Resistance</th>
                <th className="px-2 font-medium">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className={`border-t border-[var(--border)] text-right hover:bg-slate-800/40 ${r.nearLevel ? "bg-amber-950/40" : ""}`}
                >
                  <td className="py-1.5 text-left">
                    <div className="font-medium">{r.name}</div>
                    <div className="font-mono text-xs text-[var(--muted)]">{r.key}</div>
                  </td>
                  <td className="px-2 font-mono tabular-nums">{fmtPrice(r.cmp)}</td>
                  <td className={`px-2 font-mono tabular-nums ${pctTone(r.dayPct)}`}>{fmtPct(r.dayPct)}</td>
                  <td className="px-2 font-mono tabular-nums">
                    {fmtPrice(r.ema50)}
                    <div className={`text-xs ${pctTone(r.fromEma50)}`}>{fmtPct(r.fromEma50)}</div>
                  </td>
                  <td className="px-2 font-mono tabular-nums">
                    {r.notEnoughHistory ? (
                      <span className="text-xs text-[var(--muted)]">not enough history</span>
                    ) : (
                      <>
                        {fmtPrice(r.ema200)}
                        <div className={`text-xs ${pctTone(r.fromEma200)}`}>{fmtPct(r.fromEma200)}</div>
                      </>
                    )}
                  </td>
                  <td className="px-2">{r.trend ? TREND_LABEL[r.trend] : "—"}</td>
                  <td className="px-2">{levelCell(r, "support")}</td>
                  <td className="px-2">{levelCell(r, "resistance")}</td>
                  <td className="px-2">
                    <button
                      type="button"
                      onClick={() => remove(r.key)}
                      aria-label={`Remove ${r.name}`}
                      className="text-[var(--muted)] hover:text-[var(--down)]"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
