import { NextResponse } from "next/server";
import { getRepo } from "@/lib/api/server";
import { kickSnapshots } from "@/lib/api/snapshotKick";
import { runDelivery } from "@/lib/jobs/delivery";
import { isAuthorized } from "../eod/auth";

// NSE publishes the delivery file in the evening, after the EOD run, so this has its own cron.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!isAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const run = await runDelivery(getRepo(), new Date());
  // Delivery is the last input of the day, so the score snapshots start here (Hobby plans cannot add a third cron).
  const snapshots = await kickSnapshots(new URL(req.url).origin, process.env.CRON_SECRET, 0);
  return NextResponse.json({ ...run, snapshots });
}
