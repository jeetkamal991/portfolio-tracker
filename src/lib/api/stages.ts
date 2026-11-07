import { computeStage, type StageResult } from "@/lib/calc/stage";
import type { Repo } from "@/lib/db/repo";

/** About 90 weeks of sessions: 34 weeks for the first stage, plus the 26-week look-back and room for the breakout base. */
export const STAGE_SESSIONS = 450;

/** Stage of each instrument from one batched read of its recent daily candles. `asOf` is today's IST date. */
export async function loadStages(repo: Repo, instrumentIds: number[], asOf: string): Promise<Map<number, StageResult>> {
  const ids = [...new Set(instrumentIds)];
  if (ids.length === 0) return new Map();
  const recent = await repo.getRecentDays(ids, STAGE_SESSIONS);
  return new Map(ids.map((id) => [id, computeStage(recent.get(id) ?? [], asOf)]));
}
