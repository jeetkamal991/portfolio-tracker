import type { PopupData } from "@/lib/view/popup";

export function IndicatorTab({ rows, date }: { rows: PopupData["indicatorTable"]; date: string | null }) {
  return (
    <div className="flex flex-col gap-2">
      {date && <p className="font-mono text-[11px] text-[var(--muted)]">Latest session: {date}</p>}
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
            <tr>
              <th className="py-1 text-left font-medium">Indicator</th>
              <th className="px-2 text-right font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-[var(--border)] hover:bg-slate-800/40">
                <td className="py-1.5 text-[var(--muted)]">{r.label}</td>
                <td className="whitespace-nowrap px-2 text-right font-mono tabular-nums">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
