import type { Trend } from "@/lib/calc/levels";
import { fmtPct, heatColor, type HeatPeriod, type SectorRow } from "@/lib/view/dashboard";

const COLS: { id: HeatPeriod; label: string }[] = [
  { id: "d1", label: "1D" },
  { id: "w1", label: "1W" },
  { id: "m1", label: "1M" },
  { id: "m3", label: "3M" },
];
const TREND: Record<Trend, string> = { above_both: "Above 50 & 200", between: "Between", below_both: "Below 50 & 200" };

export function SectorHeatmap({ rows }: { rows: SectorRow[] }) {
  return (
    <section aria-label="Sector heatmap">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Sectors</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-separate border-spacing-0.5 text-sm">
          <thead>
            <tr className="text-xs text-neutral-500">
              <th className="px-2 py-1 text-left font-medium">Sector</th>
              {COLS.map((c) => (
                <th key={c.id} className="px-2 py-1 text-right font-medium">{c.label}</th>
              ))}
              <th className="px-2 py-1 text-left font-medium">Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="whitespace-nowrap px-2 py-1.5">{r.name.replace(/^Nifty /, "")}</td>
                {COLS.map((c) => (
                  <td
                    key={c.id}
                    className="rounded px-2 py-1.5 text-right tabular-nums"
                    style={{ backgroundColor: heatColor(r[c.id], c.id) }}
                  >
                    {fmtPct(r[c.id])}
                  </td>
                ))}
                <td className="whitespace-nowrap px-2 py-1.5 text-xs text-neutral-500">{r.trend ? TREND[r.trend] : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
