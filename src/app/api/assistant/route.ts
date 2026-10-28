import { join } from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { handleAssistantRun } from "@/lib/api/assistant";
import { getRepo } from "@/lib/api/server";
import { isBusy, runAssistant } from "@/lib/assistant/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const r = await handleAssistantRun(
    { repo: getRepo(), run: runAssistant, isBusy, env: process.env, signal: req.signal, cwd: join(process.cwd(), "assistant") },
    body,
  );
  if ("stream" in r) {
    return new Response(r.stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", Connection: "keep-alive" } });
  }
  return NextResponse.json(r.body, { status: r.status });
}
