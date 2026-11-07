import { NextResponse, type NextRequest } from "next/server";
import { handleResultsDatePut } from "@/lib/api/levels";
import { getRepo } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const body = await req.json().catch(() => null);
  const r = await handleResultsDatePut(getRepo(), key, body);
  return NextResponse.json(r.body, { status: r.status });
}
