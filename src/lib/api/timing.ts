import { NextResponse } from "next/server";

/**
 * JSON response carrying a `Server-Timing` header (visible in the browser's Network > Timing tab) so slowness can be
 * attributed to the handler instead of guessed at. `PERF_LOG=1` also prints it to the server log.
 */
export function timedJson(body: unknown, status: number, startedAt: number, label = "handler"): NextResponse {
  const dur = performance.now() - startedAt;
  if (process.env.PERF_LOG === "1") console.log(`[perf] ${label} ${dur.toFixed(0)} ms`);
  const res = NextResponse.json(body, { status });
  res.headers.set("Server-Timing", `${label};dur=${dur.toFixed(1)}`);
  return res;
}
