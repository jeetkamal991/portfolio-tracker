"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { HoldingStatus } from "@/lib/calc/portfolio";
import { daysToResults, resultsLabel } from "@/lib/calc/resultsRisk";
import type { StageResult } from "@/lib/calc/stage";
import { fmtPct, pctTone } from "@/lib/view/dashboard";
import { fmtInr, fmtSignedInr, sortPortfolioRows, type PortfolioRow, type PortfolioSortKey } from "@/lib/view/portfolio";
import { ScoreLabelChip } from "../popup/ScoreBadge";
import { StageChip } from "../StageChip";
import { StockLink } from "../popup/StockLink";
import { Chip, Panel, type Tone } from "../ui";
import { mutate } from "@/lib/client/cache";

type Dir = "asc" | "desc";

const COLUMNS: { key: PortfolioSortKey | null; label: string; left?: boolean }[] = [
  { key: "name", label: "Stock", left: true },
  { key: "qty", label: "Qty" },
  { key: "avgPrice", label: "Avg buy" },
  { key: "cmp", label: "CMP" },
  { key: "invested", label: "Invested" },
  { key: "value", label: "Value" },
  { key: "pnl", label: "P/L" },
  { key: null, label: "SL" },
  { key: null, label: "T1" },
  { key: null, label: "Status" },
  { key: "score", label: "Score" },
];

const STATUS: Record<HoldingStatus, { text: string; tone: Tone }> = {
  OK: { text: "OK", tone: "neutral" },
  NEAR_SL: { text: "Near SL", tone: "warn" },
  SL_HIT: { text: "SL hit", tone: "down" },
  NEAR_TARGET: { text: "Near target", tone: "warn" },
  TARGET_HIT: { text: "Target hit", tone: "up" },
};

const STICKY = "sticky left-0 z-10";
const STICKY_BG = "max-sm:bg-[var(--panel)]";
const MONO = "px-2 font-mono tabular-nums";

export function AddHoldingButton({ onClick }: { onClick: (opener: HTMLElement) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => onClick(e.currentTarget)}
      className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 font-mono text-xs font-semibold text-[var(--text)] hover:border-[var(--up)] hover:text-[var(--up)]"
    >
      + Add holding
    </button>
  );
}

function Money({ pnl, pct }: { pnl: number | null; pct?: number | null }) {
  if (pnl === null) return <span className="text-[var(--muted)]">—</span>;
  return (
    <span className={`inline-flex flex-col items-end ${pctTone(pnl)}`}>
      <span>{fmtSignedInr(pnl, 0)}</span>
      {pct !== undefined && pct !== null && <span className="text-[10px]">{fmtPct(pct)}</span>}
    </span>
  );
}

export function HoldingsTable({
  rows: input,
  results,
  stages,
  today,
  onAdd,
  onEdit,
}: {
  rows: PortfolioRow[];
  results: Record<string, string>;
  stages: Record<string, StageResult>;
  today: string;
  onAdd: (opener: HTMLElement) => void;
  onEdit: (key: string, opener: HTMLElement) => void;
}) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: PortfolioSortKey; dir: Dir }>({ key: "value", dir: "desc" });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = sortPortfolioRows(input, sort.key, sort.dir);

  function toggleSort(key: PortfolioSortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  }

  async function remove(key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await mutate(`/api/holdings/${encodeURIComponent(key)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setConfirming(null);
      router.refresh();
    } catch {
      setError("Could not remove holding");
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <Panel title="No holdings yet">
        <p className="mb-3 text-sm text-[var(--muted)]">Add your first holding to track invested value, P/L and stop-loss alerts.</p>
        <AddHoldingButton onClick={onAdd} />
      </Panel>
    );
  }

  return (
    <Panel title={`HOLDINGS · ${rows.length}`} action={<AddHoldingButton onClick={onAdd} />}>
      {error && (
        <p role="alert" className="mb-2 text-xs text-[var(--down)]">
          {error}
        </p>
      )}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
            <tr className="text-right">
              {COLUMNS.map((c, i) => {
                const active = c.key !== null && sort.key === c.key;
                const cls = `${c.left ? "text-left" : ""} px-2 py-2 font-medium ${i === 0 ? `${STICKY} ${STICKY_BG} pl-2.5 sm:static` : ""}`;
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
              <th className="sticky right-0 z-10 bg-[var(--panel)] px-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = r.status ? STATUS[r.status] : null;
              const soon = daysToResults(results[r.key], today);
              return (
                <tr key={r.key} className="border-t border-[var(--border)] text-right hover:bg-slate-800/40">
                  <td className={`${STICKY} ${STICKY_BG} py-2 pl-2.5 pr-2 text-left sm:static`}>
                    <StockLink stockKey={r.key} className="block">
                      <div className="max-w-[12rem] truncate font-medium hover:text-[var(--up)]">{r.name}</div>
                      <div className="font-mono text-xs text-[var(--muted)]">{r.key}</div>
                    </StockLink>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <StageChip stage={stages[r.key]} />
                      {soon !== null && <Chip tone="warn">{resultsLabel(soon)}</Chip>}
                    </div>
                  </td>
                  <td className={MONO}>{r.qty.toLocaleString("en-IN")}</td>
                  <td className={MONO}>{fmtInr(r.avgPrice, 2)}</td>
                  <td className={MONO} title={r.cmp === null ? "No price available" : undefined}>
                    <span className="inline-flex flex-col items-end">
                      <span>{fmtInr(r.cmp, 2)}</span>
                      {r.dayPct !== null && <span className={`text-[10px] ${pctTone(r.dayPct)}`}>{fmtPct(r.dayPct)}</span>}
                    </span>
                  </td>
                  <td className={MONO}>{fmtInr(r.invested, 0)}</td>
                  <td className={MONO}>{fmtInr(r.value, 0)}</td>
                  <td className={MONO}>
                    <Money pnl={r.pnl} pct={r.pnlPct} />
                  </td>
                  <td className={MONO}>{fmtInr(r.stopLoss, 2)}</td>
                  <td className={MONO}>{fmtInr(r.target1, 2)}</td>
                  <td className="px-2">{st ? <Chip tone={st.tone}>{st.text}</Chip> : "—"}</td>
                  <td className="px-2">
                    {r.score !== null && r.scoreLabel !== null ? <ScoreLabelChip label={r.scoreLabel} score={r.score} /> : "—"}
                  </td>
                  <td className="sticky right-0 z-10 whitespace-nowrap bg-[var(--panel)] px-2 text-xs">
                    {confirming === r.key ? (
                      <span role="group" aria-label={`Confirm removing ${r.name}`} className="inline-flex items-center gap-2">
                        <span className="text-[var(--muted)]">Remove?</span>
                        <button
                          type="button"
                          autoFocus
                          disabled={busy === r.key}
                          onClick={() => remove(r.key)}
                          className="font-semibold text-[var(--down)] hover:underline disabled:opacity-50"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          disabled={busy === r.key}
                          onClick={() => setConfirming(null)}
                          className="text-[var(--muted)] hover:text-[var(--text)]"
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          aria-label={`Edit ${r.name}`}
                          onClick={(e) => onEdit(r.key, e.currentTarget)}
                          className="text-[var(--muted)] hover:text-[var(--text)]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${r.name}`}
                          onClick={() => {
                            setError(null);
                            setConfirming(r.key);
                          }}
                          className="text-[var(--muted)] hover:text-[var(--down)]"
                        >
                          Remove
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
