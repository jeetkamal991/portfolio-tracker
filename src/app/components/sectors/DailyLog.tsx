import Link from "next/link";
import { LOG_COLUMNS, logCellColor, type LogMonth } from "@/lib/view/dailyLog";
import { fmtDate, fmtPct } from "@/lib/view/dashboard";
import { Panel } from "../ui";

// Opaque background only at phone width, where the Date column is pinned (as in WatchlistTable).
const STICKY = "sticky left-0 z-10 sm:static";
const STICKY_BG = "max-sm:bg-[var(--panel)]";

const shortDate = (iso: string) => fmtDate(iso).slice(0, 6);
const tone = (v: number | null) => (v === null ? "text-[var(--muted)]" : v < 0 ? "text-[var(--down)]" : "text-[var(--up)]");

/** `selected` is the sector kept in ?s=; `monthId` the validated ?m= (null → current month). */
export function DailyLog({ months, monthId, selected }: { months: LogMonth[]; monthId: string | null; selected: string | null }) {
  const month = months.find((m) => m.id === monthId) ?? months[0];
  const href = (id: string) => {
    const q = new URLSearchParams();
    if (selected) q.set("s", selected);
    q.set("m", id);
    return `/sectors?${q.toString()}`;
  };

  return (
    <Panel title="DAILY SECTOR LOG">
      {month.rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No trading days recorded for this month yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
              <tr>
                <th className={`${STICKY} ${STICKY_BG} py-2 pl-2.5 pr-2 text-left font-medium`}>Date</th>
                {LOG_COLUMNS.map((c) => (
                  <th key={c.key} className="px-2 text-right font-medium">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[var(--border)] font-bold">
                <td className={`${STICKY} ${STICKY_BG} py-1.5 pl-2.5 pr-2 text-left`}>Total</td>
                {LOG_COLUMNS.map((c) => {
                  const t = month.totals[c.key];
                  return (
                    <td
                      key={c.key}
                      title={t.compound === null ? undefined : `Compounded: ${fmtPct(t.compound)}`}
                      className={`px-2 py-1.5 text-right font-mono tabular-nums ${tone(t.sum)}`}
                      style={{ backgroundColor: logCellColor(t.sum, "total") }}
                    >
                      {fmtPct(t.sum)}
                    </td>
                  );
                })}
              </tr>
              {month.rows.map((r) => (
                <tr key={r.date} className="border-t border-[var(--border)]">
                  <td className={`${STICKY} ${STICKY_BG} py-1.5 pl-2.5 pr-2 text-left font-mono text-xs`}>{shortDate(r.date)}</td>
                  {LOG_COLUMNS.map((c) => {
                    const v = r.values[c.key];
                    return (
                      <td
                        key={c.key}
                        className={`px-2 py-1.5 text-right font-mono tabular-nums ${tone(v)}`}
                        style={{ backgroundColor: logCellColor(v, "day") }}
                      >
                        {fmtPct(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav aria-label="Month" className="mt-4 flex gap-1 overflow-x-auto border-t border-[var(--border)] pt-2">
        {months.map((m) => {
          const active = m.id === month.id;
          return (
            <Link
              key={m.id}
              href={href(m.id)}
              scroll={false}
              replace
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap border-t-2 px-3 py-1.5 font-mono text-xs uppercase tracking-wider ${
                active ? "border-[var(--up)] text-[var(--up)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {m.label}
            </Link>
          );
        })}
      </nav>
    </Panel>
  );
}
