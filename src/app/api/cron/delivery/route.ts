import { NextResponse } from "next/server";
import { getRepo } from "@/lib/api/server";
import { runDelivery } from "@/lib/jobs/delivery";
import { isAuthorized } from "../eod/auth";

// NSE publishes the delivery file in the evening, after the EOD run, so this has its own cron.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!isAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runDelivery(getRepo(), new Date()));
}
