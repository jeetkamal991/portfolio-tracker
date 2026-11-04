"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtPct, fmtPrice, parseLevelInput, pctTone } from "@/lib/view/dashboard";
import { ladderPos } from "@/lib/view/portfolio";
import {
  buildWatchRow,
  signalChip,
  sortWatchRows,
  tabRows,
  WATCH_TABS,
  type WatchInput,
  type WatchRow,
  type WatchSignals,
  type WatchSortKey,
  type WatchTab,
} from "@/lib/view/watchlist";
import { useQuotes } from "./QuotesProvider";
import { ScoreRing } from "./ScoreRing";
import { Sparkline } from "./Sparkline";
import { StockLink } from "./popup/StockLink";
import { Chip, Label, Panel } from "./ui";

type Side = "support" | "resistance";
const SORTS: { key: WatchSortKey; label: string; dir: "asc" | "desc" }[] = [
  { key: "score", label: "Score", dir: "desc" },
  { key: "dayPct", label: "Day %", dir: "desc" },
  { key: "rsi", label: "RSI", dir: "desc" },
  { key: "name", label: "Name", dir: "asc" },
];

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
      <Label>{label}</Label>
      <div className={`font-mono text-xl font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function EmaBox({ label, value, above, note }: { label: string; value: number | null; above: boolean | null; note?: string }) {
  const tint = above === null ? "border-[var(--border)] bg-[var(--panel-2)]" : above ? "border-emerald-500/30 bg-emerald-950/30" : "border-rose-500/30 bg-rose-950/30";
  const word = above === null ? "—" : above ? "▲ ABOVE" : "▼ BELOW";
  const tone = above === null ? "text-[var(--muted)]" : above ? "text-[var(--up)]" : "text-[var(--down)]";
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${tint}`} title={note}>
      <Label>{label}</Label>
      <div className="font-mono text-[13px] font-semibold tabular-nums">{fmtPrice(value)}</div>
      <div className={`font-mono text-[10px] font-semibold ${tone}`}>{word}</div>
    </div>
  );
}

export function WatchlistTiles({ inputs, signals }: { inputs: WatchInput[]; signals: WatchSignals }) {
  const router = useRouter();
  const { quotes } = useQuotes();
  const [tab, setTab] = useState<WatchTab>("all");
  const [sort, setSort] = useState(0);
  const [editing, setEditing] = useState<{ key: string; side: Side } | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const built = inputs.flatMap((it) => {
    const q = quotes[it.ticker];
    const row = buildWatchRow(it, q ? { price: q.price, changePct: q.changePct } : null);
    return row ? [row] : [];
  });
  const sortBy = SORTS[sort]!;
  const sorted = sortWatchRows(built, sortBy.key, sortBy.dir);
  const shown = tabRows(sorted, tab, signals);
  const hint = WATCH_TABS.find((t) => t.id === tab)?.hint ?? "";

  const scored = built.filter((r) => r.score !== null);
  const avg = scored.length === 0 ? null : Math.round(scored.reduce((a, r) => a + r.score!, 0) / scored.length);
  const up = built.filter((r) => (r.dayPct ?? 0) > 0).length;

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
      const res = await fetch(`/api/levels/${encodeURIComponent(row.key)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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

  function level(row: WatchRow, side: Side) {
    const value = side === "support" ? row.support : row.resistance;
    const manual = side === "support" ? row.supportIsManual : row.resistanceIsManual;
    const dist = side === "support" ? row.toSupport : row.toResistance;
    const name = side === "support" ? "Support" : "Resistance";
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
          className="w-full rounded border border-[var(--border)] bg-[var(--panel-2)] px-1 font-mono tabular-nums focus:border-[var(--up)] focus:outline-none"
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
        className="flex w-full flex-col items-start text-left hover:underline"
      >
        <span className="font-mono text-[13px] font-semibold tabular-nums">
          {manual && <span className="mr-1 rounded border border-amber-400/40 bg-amber-950/70 px-1 text-[10px] font-semibold text-[var(--warn)]">M</span>}
          {fmtPrice(value)}
        </span>
        <span className="font-mono text-[10px] text-[var(--muted)]">
          {value === null ? (side === "support" ? "none below price" : "none above price") : dist === null ? name : `${fmtPct(dist)} ${side === "support" ? "away" : "to go"}`}
        </span>
      </button>
    );
  }

  function tile(r: WatchRow) {
    const pos = ladderPos(r.cmp, r.support, r.resistance);
    const chip = signalChip(r.key, signals);
    return (
      <article key={r.key} className={`relative flex min-w-0 flex-col gap-3 rounded-xl border bg-[var(--panel)] p-4 ${r.nearLevel ? "border-amber-400/40" : "border-[var(--border)]"}`}>
        <button type="button" onClick={() => void remove(r.key)} aria-label={`Remove ${r.name}`} className="absolute right-3 top-3 text-xs text-[var(--muted)] hover:text-[var(--down)]">
          ✕
        </button>
        <div className="flex items-center gap-3 pr-5">
          <ScoreRing score={r.score} size={56} caption={false} />
          <div className="min-w-0 flex-1">
            <StockLink stockKey={r.key} className="line-clamp-2 text-[15px] font-bold leading-snug">
              {r.name}
            </StockLink>
            <p className="font-mono text-[11px] text-[var(--muted)]">
              {r.key}
              {r.scoreLabel ? ` · ${r.scoreLabel}${r.scorePartial ? " (partial)" : ""}` : ""}
            </p>
          </div>
          <div className="text-right">
            <div className="font-mono text-sm font-semibold tabular-nums">{fmtPrice(r.cmp)}</div>
            <div className={`font-mono text-xs tabular-nums ${pctTone(r.dayPct)}`}>{fmtPct(r.dayPct)}</div>
          </div>
        </div>

        <div>
          <Label>EMA trend</Label>
          <div className="mt-1 grid grid-cols-3 gap-1.5">
            <EmaBox label="EMA 20" value={r.ema20} above={r.above20} />
            <EmaBox label="EMA 50" value={r.ema50} above={r.above50} />
            <EmaBox label="EMA 200" value={r.ema200} above={r.above200} note={r.notEnoughHistory ? "not enough history" : undefined} />
          </div>
        </div>

        <div>
          <Label>Support and resistance</Label>
          <div className="mt-1 grid grid-cols-2 gap-1.5">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5">
              <Label>Support</Label>
              {level(r, "support")}
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5">
              <Label>Resistance</Label>
              {level(r, "resistance")}
            </div>
          </div>
          {pos !== null && (
            <div className="relative mx-0.5 mt-2.5 h-2 rounded-md" style={{ background: "linear-gradient(90deg, rgba(251,113,133,.33), rgba(251,191,36,.22) 45%, rgba(52,211,153,.33))" }} role="img" aria-label="Price between support and resistance">
              <i className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded-sm bg-[var(--text)] shadow-[0_0_0_2px_var(--panel)]" style={{ left: `${(pos * 100).toFixed(0)}%` }} />
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5">
            <Label>RSI</Label>
            <div className={`font-mono text-[13px] font-semibold tabular-nums ${r.rsi !== null && (r.rsi > 70 || r.rsi < 30) ? "text-[var(--warn)]" : ""}`}>{r.rsi === null ? "—" : r.rsi.toFixed(1)}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5">
            <Label>Volume</Label>
            <div className={`font-mono text-[13px] font-semibold tabular-nums ${r.volRatio !== null && r.volRatio >= 2 ? "text-[var(--warn)]" : ""}`}>{r.volRatio === null ? "—" : `${r.volRatio.toFixed(1)}×`}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5">
            <Label>52W high</Label>
            <div className="font-mono text-[13px] font-semibold tabular-nums">{r.fromHigh === null ? "—" : fmtPct(r.fromHigh)}</div>
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2">
          <Sparkline values={r.spark} />
          {chip && <Chip tone={chip.tone}>{chip.label}</Chip>}
        </div>
      </article>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Stocks" value={String(built.length)} />
        <Stat label="Up today" value={`${up} / ${built.length}`} tone="text-[var(--up)]" />
        <Stat label="Average score" value={avg === null ? "—" : String(avg)} />
        <Stat label="Crosses (5 sessions)" value={String(new Set([...signals.golden, ...signals.death]).size)} tone="text-[var(--warn)]" />
        <Stat label="Volume shockers" value={String(signals.volume.length)} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Signal" className="flex flex-wrap gap-2">
          {WATCH_TABS.map((t) => {
            const on = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${on ? "border-[var(--text)] bg-[var(--text)] text-[var(--bg)]" : "border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)]"}`}
              >
                {t.label}
                <span className="ml-1.5 font-mono text-xs">{tabRows(built, t.id, signals).length}</span>
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
          Sort
          <select value={sort} onChange={(e) => setSort(Number(e.target.value))} className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-sm text-[var(--text)]">
            {SORTS.map((s, i) => (
              <option key={s.key} value={i}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-[var(--muted)]">{hint}</p>

      {error && (
        <p role="alert" className="text-xs text-[var(--down)]">
          {error}
        </p>
      )}

      {built.length === 0 ? (
        <Panel>
          <p className="text-sm text-[var(--muted)]">Your watchlist is empty. Search for a stock above to add it.</p>
        </Panel>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted)]">
          No stock on your watchlist matches this right now. It will appear here when one does.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{shown.map(tile)}</div>
      )}
    </div>
  );
}
