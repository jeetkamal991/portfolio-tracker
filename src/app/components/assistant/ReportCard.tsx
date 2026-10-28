import Link from "next/link";

export function ReportCard({ id }: { id: number }) {
  return (
    <Link
      href={`/backtests/${id}`}
      className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3 text-sm hover:border-[var(--up)]"
    >
      <span className="font-semibold">Backtest report #{id}</span>
      <span className="font-mono text-xs text-[var(--up)]">Open →</span>
    </Link>
  );
}
