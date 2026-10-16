import type { NextRequest } from "next/server";
import { getRepo } from "@/lib/api/server";
import { handleWatchlistDelete } from "@/lib/api/watchlist";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  await handleWatchlistDelete({ repo: getRepo() }, key);
  return new Response(null, { status: 204 });
}
