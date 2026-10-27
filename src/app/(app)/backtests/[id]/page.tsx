import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/api/server";
import { parseRunId } from "@/lib/view/backtests";
import { RunDetail } from "../../../components/backtests/RunDetail";
import { Panel } from "../../../components/ui";

export const dynamic = "force-dynamic";

export default async function BacktestPage({ params }: { params: Promise<{ id: string }> }) {
  const runId = parseRunId((await params).id);
  if (runId === null) notFound();
  let run;
  try {
    run = await getRepo().getBacktestRun(runId);
  } catch (e) {
    console.error("getBacktestRun failed", e);
    return (
      <Panel title="BACKTEST">
        <p className="text-sm text-[var(--warn)]">
          Couldn&apos;t read this run. Apply <code className="font-mono">supabase/migrations/0010_backtest_runs.sql</code>, then reload.
        </p>
      </Panel>
    );
  }
  if (!run) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/backtests" className="self-start font-mono text-xs text-[var(--muted)] hover:text-[var(--text)]">
        ← All runs
      </Link>
      <RunDetail run={run} />
    </div>
  );
}
