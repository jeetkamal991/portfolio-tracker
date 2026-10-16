import { NextResponse, type NextRequest } from "next/server";
import { getRepo, provider } from "@/lib/api/server";
import { handleWatchlistPost } from "@/lib/api/watchlist";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const r = await handleWatchlistPost({ repo: getRepo(), provider, now: new Date() }, body);
  return NextResponse.json(r.body, { status: r.status });
}
