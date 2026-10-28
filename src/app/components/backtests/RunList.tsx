import Link from "next/link";
import type { BacktestRunSummary } from "@/lib/db/types";
import { fmtFrac, fmtRatio } from "@/lib/view/backtests";
import { Panel } from "../ui";

const TH = "whitespace-nowrap px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]";
const TD = "whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums";

export function RunList({ runs }: { runs: BacktestRunSummary[] }) {
  if (runs.length === 0) {
    return (
      <Panel title="BACKTEST REPORTS">
        <p className="text-sm text-[var(--muted)]">
          No runs yet. Run <code className="font-mono">npm run backtest</code> on your PC, for example{" "}
          <code className="font-mono">npm run backtest -- alpha --alpha a101 --top 10</code>.
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="BACKTEST REPORTS">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse sm:min-w-[720px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={TH}>Run</th>
              <th className={`${TH} hidden sm:table-cell`}>Period</th>
              <th className={`${TH} text-right`}>CAGR</th>
              <th className={`${TH} text-right`}>Max DD</th>
              <th className={`${TH} hidden text-right sm:table-cell`}>Sharpe</th>
              <th className={`${TH} hidden text-right sm:table-cell`}>Nifty 50 CAGR</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const s = r.metrics?.strategy;
              return (
                <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-2">
                    <Link href={`/backtests/${r.id}`} className="text-sm font-semibold hover:text-[var(--up)]">
                      {r.name}
                    </Link>
                    <div className="font-mono text-xs text-[var(--muted)]">{r.strategy?.label}</div>
                  </td>
                  <td className={`${TD} hidden text-[var(--muted)] sm:table-cell`}>{r.settings ? `${r.settings.from} to ${r.settings.to}` : "—"}</td>
                  <td className={`${TD} text-right`}>{fmtFrac(s?.cagr ?? null)}</td>
                  <td className={`${TD} text-right`}>{fmtFrac(s?.maxDrawdown ?? null)}</td>
                  <td className={`${TD} hidden text-right sm:table-cell`}>{fmtRatio(s?.sharpe ?? null)}</td>
                  <td className={`${TD} hidden text-right text-[var(--muted)] sm:table-cell`}>{fmtFrac(r.metrics?.benchmark?.cagr ?? null)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
