import Link from "next/link";
import type { RotationRow } from "@/lib/calc/rotation";
import { Sparkline } from "../Sparkline";
import { Panel, PctText } from "../ui";

function Change({ row }: { row: RotationRow }) {
  if (row.rank === null) return <span className="text-[var(--muted)]">—</span>;
  if (row.change === null) return <span className="text-[var(--muted)]">new</span>;
  if (row.change > 0) return <span className="text-[var(--up)]">▲{row.change}</span>;
  if (row.change < 0) return <span className="text-[var(--down)]">▼{-row.change}</span>;
  return <span className="text-[var(--muted)]">–</span>;
}

export function RotationPanel({ rows }: { rows: RotationRow[] }) {
  return (
    <Panel title="SECTOR ROTATION · RS vs NIFTY (4W)">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
              <th className="py-2 pr-2 text-left font-medium">Rank</th>
              <th className="px-2 text-left font-medium">Sector</th>
              <th className="px-2 text-right font-medium">RS</th>
              <th className="px-2 text-right font-medium">Wk chg</th>
              <th className="pl-2 text-right font-medium">8W rank</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-[var(--border)]">
                <td className="py-2 pr-2 font-mono tabular-nums">{r.rank === null ? "—" : `#${r.rank}`}</td>
                <td className="px-2">
                  <Link href={`/sectors?s=${encodeURIComponent(r.key)}`} scroll={false} className="font-medium hover:text-[var(--up)]">
                    {r.name.replace(/^Nifty /, "")}
                  </Link>
                </td>
                <td className="px-2 text-right"><PctText value={r.rs} /></td>
                <td className="px-2 text-right font-mono tabular-nums"><Change row={r} /></td>
                <td className="pl-2">
                  <div className="flex justify-end">
                    {/* Negated so rank 1 plots highest. */}
                    <Sparkline values={r.history.flatMap((h) => (h === null ? [] : [-h]))} label="8-week rank" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
