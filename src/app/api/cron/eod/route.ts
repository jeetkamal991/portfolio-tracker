import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { createYahooProvider } from "@/lib/provider/yahoo";
import { runEod } from "@/lib/jobs/eod";
import { isAuthorized } from "./auth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!isAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const run = await runEod({
    repo: createSupabaseRepo(createAdminClient()),
    provider: createYahooProvider(),
    now: new Date(),
  });
  return NextResponse.json(run);
}
