import { NextResponse } from "next/server";
import { handleMovers } from "@/lib/api/movers";
import { getRepo, quoteCache } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await handleMovers(getRepo(), quoteCache, new Date()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "movers_unavailable" }, { status: 502 });
  }
}
