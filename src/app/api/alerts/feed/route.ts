import { NextResponse } from "next/server";
import { handleAlertFeed } from "@/lib/api/alerts";
import { getRepo } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = await handleAlertFeed(getRepo());
  return NextResponse.json(r.body, { status: r.status });
}
