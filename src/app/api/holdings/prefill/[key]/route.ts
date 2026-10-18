import { NextResponse, type NextRequest } from "next/server";
import { handleHoldingPrefill } from "@/lib/api/portfolio";
import { getRepo } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const r = await handleHoldingPrefill(getRepo(), key);
  return NextResponse.json(r.body, { status: r.status });
}
