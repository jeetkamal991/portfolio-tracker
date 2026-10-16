import { fmtPct, pctTone } from "@/lib/view/dashboard";

export function TodaySummary({ nifty, bankNifty }: { nifty: number | null; bankNifty: number | null }) {
  const cell = (label: string, v: number | null) => (
    <div className="flex-1 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${pctTone(v)}`}>{fmtPct(v)}</div>
    </div>
  );
  return (
    <section aria-label="Today's summary">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Today</h2>
      <div className="flex gap-3">
        {cell("Nifty 50", nifty)}
        {cell("Bank Nifty", bankNifty)}
      </div>
    </section>
  );
}
