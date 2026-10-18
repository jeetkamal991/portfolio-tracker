import { fmtPct, fmtPrice, pctTone } from "@/lib/view/dashboard";
import type { ConstituentRow } from "@/lib/view/sectors";
import { ScoreLabelChip } from "../popup/ScoreBadge";
import { StockLink } from "../popup/StockLink";
import { TrendChip } from "../TrendChip";

export const IMPORT_MESSAGE = "Constituents appear after the niftyindices import.";

/** Rows arrive sorted by day % (desc, no-data rows last). */
export function ConstituentTable({ rows }: { rows: ConstituentRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-[var(--muted)]">{IMPORT_MESSAGE}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
            <th className="py-2 pr-2 text-left font-medium">Stock</th>
            <th className="px-2 text-right font-medium">CMP</th>
            <th className="px-2 text-right font-medium">Day %</th>
            <th className="px-2 text-right font-medium">Score</th>
            <th className="px-2 text-right font-medium">Trend</th>
            <th className="pl-2 text-right font-medium">RSI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-[var(--border)] text-right hover:bg-slate-800/40">
              <td className="py-2 pr-2 text-left">
                <StockLink stockKey={r.key} className="block">
                  <div className="max-w-[14rem] truncate font-medium">{r.name}</div>
                  <div className="font-mono text-xs text-[var(--muted)]">{r.key}</div>
                </StockLink>
              </td>
              <td className="px-2 font-mono tabular-nums">{fmtPrice(r.cmp)}</td>
              <td className={`px-2 font-mono tabular-nums ${pctTone(r.dayPct)}`}>{fmtPct(r.dayPct)}</td>
              <td className="px-2">{r.scoreLabel ? <ScoreLabelChip label={r.scoreLabel} score={r.score ?? undefined} /> : "—"}</td>
              <td className="px-2"><TrendChip trend={r.trend} /></td>
              <td className={`pl-2 font-mono tabular-nums ${r.rsi !== null && (r.rsi > 70 || r.rsi < 30) ? "text-[var(--warn)]" : ""}`}>
                {r.rsi === null ? "—" : r.rsi.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
