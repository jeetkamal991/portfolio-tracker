import { NextResponse, type NextRequest } from "next/server";
import { handleReportDelete } from "@/lib/api/instrument";
import { getRepo } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await handleReportDelete(getRepo(), id);
  return r.status === 204 ? new NextResponse(null, { status: 204 }) : NextResponse.json(r.body, { status: r.status });
}
