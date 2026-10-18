import { NextResponse, type NextRequest } from "next/server";
import { handleHoldingPost } from "@/lib/api/portfolio";
import { getRepo, provider } from "@/lib/api/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const r = await handleHoldingPost({ repo: getRepo(), provider, now: new Date() }, body);
  return NextResponse.json(r.body, { status: r.status });
}
