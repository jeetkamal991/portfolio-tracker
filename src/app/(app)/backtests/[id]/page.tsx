import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/api/server";
import { RunDetail } from "../../../components/backtests/RunDetail";

export const dynamic = "force-dynamic";

export default async function BacktestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const run = await getRepo().getBacktestRun(Number(id));
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
