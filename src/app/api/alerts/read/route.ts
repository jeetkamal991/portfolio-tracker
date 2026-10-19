import { NextResponse, type NextRequest } from "next/server";
import { handleAlertRead } from "@/lib/api/alerts";
import { getRepo } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const r = await handleAlertRead(getRepo(), body);
  return r.status === 204 ? new NextResponse(null, { status: 204 }) : NextResponse.json(r.body, { status: r.status });
}
