import { NextResponse, type NextRequest } from "next/server";
import { getRepo } from "@/lib/api/server";
import { timedJson } from "@/lib/api/timing";

export const dynamic = "force-dynamic";

const FULL_HISTORY = 5000;

/** Full price history with only the columns the chart draws; fetched when a chart range needs more than the pop-up's year. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const t0 = performance.now();
  const repo = getRepo();
  const inst = await repo.getInstrumentByKey(key);
  if (!inst) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const days = await repo.getChartDays(inst.id, FULL_HISTORY);
  return timedJson({ days }, 200, t0);
}
