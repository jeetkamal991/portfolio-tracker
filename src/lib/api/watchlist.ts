import { z } from "zod";
import type { BackfillDeps } from "@/lib/jobs/backfill";
import { addStock } from "@/lib/jobs/backfill";
import type { ApiResult } from "./levels";

const bodySchema = z.object({ key: z.string().min(1) });

export async function handleWatchlistPost(deps: BackfillDeps, body: unknown): Promise<ApiResult> {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "invalid_body" } };
  const r = await addStock(deps, parsed.data.key);
  return r.ok ? { status: 200, body: { ok: true } } : { status: 400, body: { error: r.error } };
}

export async function handleWatchlistDelete(deps: Pick<BackfillDeps, "repo">, key: string): Promise<void> {
  const inst = await deps.repo.getInstrumentByKey(key);
  if (inst) await deps.repo.removeFromWatchlist(inst.id);
}
