import { NextResponse, type NextRequest } from "next/server";
import { handleAlertDelete, handleAlertPatch } from "@/lib/api/alerts";
import { getRepo } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const r = await handleAlertPatch(getRepo(), id, body);
  return NextResponse.json(r.body, { status: r.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await handleAlertDelete(getRepo(), id);
  return r.status === 204 ? new NextResponse(null, { status: 204 }) : NextResponse.json(r.body, { status: r.status });
}
