import { fmtDate } from "@/lib/view/dashboard";

export function AsOfBadge({ date, stale }: { date: string | null; stale: boolean }) {
  const tone = stale
    ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
    : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  return (
    <span className={`rounded px-2 py-1 text-xs font-medium ${tone}`} title={stale ? "Last EOD update failed or was partial" : undefined}>
      {date ? `Data as of ${fmtDate(date)}` : "No data yet"}
      {stale ? " (stale)" : ""}
    </span>
  );
}
