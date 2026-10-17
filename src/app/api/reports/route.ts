import { NextResponse, type NextRequest } from "next/server";
import { handleReportPost } from "@/lib/api/instrument";
import { getRepo } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const r = await handleReportPost(getRepo(), body);
  return NextResponse.json(r.body, { status: r.status });
}
