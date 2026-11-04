import Link from "next/link";
import { LOG_COLUMNS, logCellColor, type LogMonth } from "@/lib/view/dailyLog";
import { fmtPct } from "@/lib/view/dashboard";
import { Label, Panel } from "../ui";

/** The Total row of the Daily Sector Log for one month: each column's daily % moves added up. */
export function DailyLogTotals({ month }: { month: LogMonth | null }) {
  return (
    <Panel
      title="MONTHLY SECTOR LOG"
      action={
        <Link href={month ? `/sectors?m=${month.id}` : "/sectors"} className="font-mono text-xs text-[var(--up)] hover:underline">
          Full log →
        </Link>
      }
    >
      {!month || month.rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No trading days recorded yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Label>
            {month.label} · total of {month.rows.length} {month.rows.length === 1 ? "day" : "days"}
          </Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {LOG_COLUMNS.map((c) => {
              const t = month.totals[c.key];
              return (
                <div
                  key={c.key}
                  title={t.compound === null ? undefined : `Compounded: ${fmtPct(t.compound)}`}
                  className="flex flex-col gap-1 rounded-lg border border-[var(--border)] px-3 py-2.5"
                  style={{ backgroundColor: logCellColor(t.sum, "total") }}
                >
                  <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">{c.label}</span>
                  <span className={`font-mono text-lg font-semibold tabular-nums ${t.sum === null ? "text-[var(--muted)]" : "text-[var(--text)]"}`}>
                    {fmtPct(t.sum)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}
