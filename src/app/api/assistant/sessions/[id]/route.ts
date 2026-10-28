import { NextResponse, type NextRequest } from "next/server";
import { getRepo } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  await getRepo().deleteAssistantSession(id);
  return new NextResponse(null, { status: 204 });
}
