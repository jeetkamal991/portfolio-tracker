import { NextResponse } from "next/server";
import { handleQuotes } from "@/lib/api/quotes";
import { getRepo, quoteCache } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await handleQuotes(getRepo(), quoteCache));
  } catch {
    return NextResponse.json({ error: "quotes_unavailable" }, { status: 502 });
  }
}
