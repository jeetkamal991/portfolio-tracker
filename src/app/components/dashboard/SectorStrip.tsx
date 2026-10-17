import Link from "next/link";
import { fmtPct, type SectorRow } from "@/lib/view/dashboard";
import { Panel } from "../ui";

export function SectorStrip({ rows }: { rows: SectorRow[] }) {
  return (
    <Panel
      title="SECTORAL PULSE"
      action={
        <Link href="/sectors" className="font-mono text-xs text-[var(--up)] hover:underline">
          All sectors →
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {rows.map((r) => {
          const tone =
            r.d1 === null || r.d1 === 0
              ? "border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"
              : r.d1 > 0
                ? "border-emerald-500/30 bg-emerald-950/30 text-[var(--up)]"
                : "border-rose-500/30 bg-rose-950/30 text-[var(--down)]";
          const arrow = r.d1 === null || r.d1 === 0 ? "" : r.d1 > 0 ? "▲ " : "▼ ";
          return (
            <Link
              key={r.key}
              href={`/sectors?s=${encodeURIComponent(r.key)}`}
              className={`flex flex-col gap-1 rounded-lg border p-3 transition-colors hover:brightness-125 ${tone}`}
            >
              <span className="truncate text-sm font-semibold text-[var(--text)]">{r.name.replace(/^Nifty /, "")}</span>
              <span className="font-mono text-sm font-semibold tabular-nums">
                {arrow}
                {fmtPct(r.d1)}
              </span>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}
