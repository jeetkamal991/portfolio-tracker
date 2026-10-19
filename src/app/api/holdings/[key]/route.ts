import { NextResponse, type NextRequest } from "next/server";
import { handleHoldingDelete, handleHoldingPut } from "@/lib/api/portfolio";
import { getRepo } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const body = await req.json().catch(() => null);
  const r = await handleHoldingPut({ repo: getRepo(), now: new Date() }, key, body);
  return NextResponse.json(r.body, { status: r.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  await handleHoldingDelete({ repo: getRepo(), now: new Date() }, key);
  return new NextResponse(null, { status: 204 });
}
