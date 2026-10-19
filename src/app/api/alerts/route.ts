import { NextResponse, type NextRequest } from "next/server";
import { handleAlertCreate, handleAlertsList } from "@/lib/api/alerts";
import { getRepo, quoteCache, telegramConfigured } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = await handleAlertsList(getRepo(), telegramConfigured());
  return NextResponse.json(r.body, { status: r.status });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const r = await handleAlertCreate({ repo: getRepo(), now: new Date(), quotes: quoteCache }, body);
  return NextResponse.json(r.body, { status: r.status });
}
