import { getRepo } from "@/lib/api/server";
import { RunList } from "../../components/backtests/RunList";
import { Panel } from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function BacktestsPage() {
  try {
    return <RunList runs={await getRepo().listBacktestRuns()} />;
  } catch (e) {
    console.error("listBacktestRuns failed", e);
    return (
      <Panel title="BACKTESTS">
        <p className="text-sm text-[var(--warn)]">
          Couldn&apos;t read the saved runs. Apply <code className="font-mono">supabase/migrations/0010_backtest_runs.sql</code>, then reload.
        </p>
      </Panel>
    );
  }
}
