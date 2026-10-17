import type { Trend } from "@/lib/calc/levels";
import { fmtPct, heatColor, type HeatPeriod, type SectorRow } from "@/lib/view/dashboard";
import { StockLink } from "./popup/StockLink";
import { Panel } from "./ui";

const COLS: { id: HeatPeriod; label: string }[] = [
  { id: "d1", label: "1D" },
  { id: "w1", label: "1W" },
  { id: "m1", label: "1M" },
  { id: "m3", label: "3M" },
];
const TREND: Record<Trend, string> = { above_both: "Above 50 & 200", between: "Between", below_both: "Below 50 & 200" };

/** `selected` (a sector key from `/sectors?s=`) is outlined so the dashboard's tile links land on their row. */
export function SectorHeatmap({ rows, selected = null }: { rows: SectorRow[]; selected?: string | null }) {
  return (
    <Panel title="Sectors">
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[420px] border-separate border-spacing-0.5 text-sm">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
              <th className="px-2 py-1 text-left font-medium">Sector</th>
              {COLS.map((c) => (
                <th key={c.id} className="px-2 py-1 text-right font-medium">{c.label}</th>
              ))}
              <th className="px-2 py-1 text-left font-medium">Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                id={r.key}
                aria-selected={r.key === selected || undefined}
                className={`hover:bg-slate-800/40 ${r.key === selected ? "outline outline-1 outline-[var(--up)]" : ""}`}
              >
                <td className="whitespace-nowrap px-2 py-1.5 font-medium">
                  <StockLink stockKey={r.key}>{r.name.replace(/^Nifty /, "")}</StockLink>
                </td>
                {COLS.map((c) => (
                  <td
                    key={c.id}
                    className="rounded px-2 py-1.5 text-right font-mono tabular-nums"
                    style={{ backgroundColor: heatColor(r[c.id], c.id) }}
                  >
                    {fmtPct(r[c.id])}
                  </td>
                ))}
                <td className="whitespace-nowrap px-2 py-1.5 text-xs text-[var(--muted)]">{r.trend ? TREND[r.trend] : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
