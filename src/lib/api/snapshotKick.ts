import { SNAPSHOT_DEFAULTS } from "@/lib/jobs/snapshots";

/**
 * Starts (or continues) the snapshot run by calling the authenticated cron route. Chaining is bounded twice: by `chain`
 * here (never more links than a run is allowed batches) and by the run's own batch allowance in score_runs. A failed or
 * slow kick is not an error: the run keeps its cursor, and the next kick (tomorrow's cron, or a manual call) resumes it.
 */
export async function kickSnapshots(origin: string, secret: string | undefined, chain: number): Promise<"kicked" | "skipped" | "failed"> {
  if (!secret || chain >= SNAPSHOT_DEFAULTS.maxBatches) return "skipped";
  try {
    // The next invocation runs to completion on its own; we only wait long enough for the request to be accepted.
    await fetch(`${origin}/api/cron/snapshots?chain=${chain + 1}`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(5_000) });
    return "kicked";
  } catch (e) {
    return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "kicked" : "failed";
  }
}
