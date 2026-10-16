import { NextResponse, type NextRequest } from "next/server";
import { handleSearch } from "@/lib/api/search";
import { getRepo } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json(await handleSearch(getRepo(), req.nextUrl.searchParams.get("q")));
}
