import { NextResponse } from "next/server";
import { getRepo } from "@/lib/api/server";
import { kickSnapshots } from "@/lib/api/snapshotKick";
import { runSnapshotBatch } from "@/lib/jobs/snapshots";
import { isAuthorized } from "../eod/auth";

// One chunk per invocation (Vercel Hobby: 300 s). Resumable: the cursor lives in score_runs.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!isAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const chain = Math.max(0, Number(url.searchParams.get("chain") ?? 0) || 0);
  let result;
  try {
    result = await runSnapshotBatch({ repo: getRepo(), now: new Date() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  const next = result.more ? await kickSnapshots(url.origin, process.env.CRON_SECRET, chain) : "skipped";
  return NextResponse.json({ ...result, chain, next });
}
