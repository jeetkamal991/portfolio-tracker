import { NextResponse } from "next/server";
import { getRepo, provider, telegram } from "@/lib/api/server";
import { runEod } from "@/lib/jobs/eod";
import { isAuthorized } from "./auth";

// Vercel Hobby allows 5 minutes: ingest + scores + the alert pass.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!isAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const run = await runEod({
    repo: getRepo(),
    provider,
    now: new Date(),
    send: telegram,
  });
  return NextResponse.json(run);
}
