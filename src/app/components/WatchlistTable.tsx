"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtPct, fmtPrice, parseLevelInput, pctTone } from "@/lib/view/dashboard";
import { buildWatchRow, sortWatchRows, type WatchInput, type WatchRow, type WatchSortKey } from "@/lib/view/watchlist";
import { useQuotes } from "./QuotesProvider";
import { ScoreLabelChip } from "./popup/ScoreBadge";
import { StockLink } from "./popup/StockLink";
import { Sparkline } from "./Sparkline";
import { TrendChip } from "./TrendChip";
import { Panel } from "./ui";


type Side = "support" | "resistance";
type Dir = "asc" | "desc";

const COLUMNS: { key: WatchSortKey | null; label: string; align?: "left" }[] = [
  { key: "name", label: "Stock", align: "left" },
  { key: "cmp", label: "CMP" },
  { key: "dayPct", label: "Day %" },
  { key: "ema20", label: "EMA 20" },
  { key: "ema50", label: "EMA 50" },
  { key: "ema200", label: "EMA 200" },
  { key: null, label: "Trend" },
  { key: "rsi", label: "RSI" },
  { key: "toSupport", label: "Support" },
  { key: "toResistance", label: "Resistance" },
  { key: "score", label: "Score" },
  { key: null, label: "1M" },
];

// The sticky first column needs an opaque background only at phone widths; from sm up it is static
// and transparent so the row's hover and near-level tints show through.
const STICKY = "sticky left-0 z-10";
const STICKY_BG = "max-sm:bg-[var(--panel)]";
// Near-level marker lives on the first cell, since a cell background paints over the row's. At phone
// width the tint is amber-950 at 20% pre-mixed onto the panel so the sticky cell stays opaque.
const NEAR_FIRST = "shadow-[inset_3px_0_0_var(--warn)] max-sm:bg-[color-mix(in_srgb,#451a03_20%,var(--panel))]";

export function WatchlistTable({ inputs }: { inputs: WatchInput[] }) {
  const router = useRouter();
  const { quotes } = useQuotes();
  const [sort, setSort] = useState<{ key: WatchSortKey; dir: Dir }>({ key: "score", dir: "desc" });
  const [editing, setEditing] = useState<{ key: string; side: Side } | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const built = inputs.flatMap((it) => {
    const q = quotes[it.ticker];
    const row = buildWatchRow(it, q ? { price: q.price, changePct: q.changePct } : null);
    return row ? [row] : [];
  });
  const rows = sortWatchRows(built, sort.key, sort.dir);

  function toggleSort(key: WatchSortKey) {
    // A new column starts descending (largest first), except the name, which starts A→Z.
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  }

  async function saveLevel(row: WatchRow, side: Side) {
    const parsed = parseLevelInput(draft);
    if (!parsed.ok) {
      setError("Enter a positive number, or leave empty to clear");
      return;
    }
    const levels = inputs.find((i) => i.key === row.key)!.levels;
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

  function emaCell(value: number | null, above: boolean | null, n: number, title?: string) {
    const tone = above === null ? "text-[var(--muted)]" : above ? "text-[var(--up)]" : "text-[var(--down)]";
    const t = title ?? (above === null ? undefined : `Price ${above ? "above" : "below"} EMA ${n}`);
    return (
      <span className={`font-mono tabular-nums ${tone}`} title={t}>
        {fmtPrice(value)}
      </span>
    );
  }

  function levelCell(row: WatchRow, side: Side) {
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
        className="inline-flex flex-col items-end font-mono tabular-nums hover:underline"
      >
        <span>
          {manual && (
            <span className="mr-1 rounded border border-amber-400/40 bg-amber-950/70 px-1 text-[10px] font-semibold text-[var(--warn)]">M</span>
          )}
          {fmtPrice(value)}
        </span>
        {dist !== null && <span className="text-[10px] text-[var(--muted)]">({fmtPct(dist)})</span>}
      </button>
    );
  }

  return (
    <Panel title={`WATCHLIST · ${rows.length} ${rows.length === 1 ? "stock" : "stocks"}`}>
      {error && (
        <p role="alert" className="mb-2 text-xs text-[var(--down)]">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Your watchlist is empty. Search for a stock above to add it.</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
              <tr className="text-right">
                {COLUMNS.map((c, i) => {
                  const active = c.key !== null && sort.key === c.key;
                  const cls = `${c.align === "left" ? "text-left" : ""} px-2 py-2 font-medium ${i === 0 ? `${STICKY} ${STICKY_BG} pl-2.5 sm:static` : ""}`;
                  return (
                    <th key={c.label} className={cls} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                      {c.key === null ? (
                        c.label
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key!)}
                          className={`uppercase tracking-wider hover:text-[var(--text)] ${active ? "text-[var(--up)]" : ""}`}
                        >
                          {c.label}
                          {active && <span aria-hidden> {sort.dir === "asc" ? "↑" : "↓"}</span>}
                        </button>
                      )}
                    </th>
                  );
                })}
                <th className="px-2 font-medium">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className={`border-t border-[var(--border)] text-right hover:bg-slate-800/40 ${
                    r.nearLevel ? "bg-amber-950/20" : ""
                  }`}
                >
                  <td className={`${STICKY} py-2 pl-2.5 pr-2 text-left sm:static ${r.nearLevel ? NEAR_FIRST : STICKY_BG}`}>
                    <StockLink stockKey={r.key} className="block">
                      <div className="max-w-[12rem] truncate font-medium hover:text-[var(--up)]">{r.name}</div>
                      <div className="font-mono text-xs text-[var(--muted)]">{r.key}</div>
                    </StockLink>
                  </td>
                  <td className="px-2 font-mono tabular-nums">{fmtPrice(r.cmp)}</td>
                  <td className={`px-2 font-mono tabular-nums ${pctTone(r.dayPct)}`}>{fmtPct(r.dayPct)}</td>
                  <td className="px-2">{emaCell(r.ema20, r.above20, 20)}</td>
                  <td className="px-2">{emaCell(r.ema50, r.above50, 50)}</td>
                  <td className="px-2">{emaCell(r.ema200, r.above200, 200, r.notEnoughHistory ? "not enough history" : undefined)}</td>
                  <td className="px-2"><TrendChip trend={r.trend} /></td>
                  <td
                    className={`px-2 font-mono tabular-nums ${
                      r.rsi !== null && (r.rsi > 70 || r.rsi < 30) ? "text-[var(--warn)]" : ""
                    }`}
                  >
                    {r.rsi === null ? "—" : r.rsi.toFixed(1)}
                  </td>
                  <td className="px-2">{levelCell(r, "support")}</td>
                  <td className="px-2">{levelCell(r, "resistance")}</td>
                  <td className="px-2">
                    {r.score !== null && r.scoreLabel !== null ? (
                      <ScoreLabelChip label={r.scoreLabel} score={r.score} title={r.scorePartial ? "partial data" : undefined} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2">
                    <div className="flex justify-end">
                      <Sparkline values={r.spark} />
                    </div>
                  </td>
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
