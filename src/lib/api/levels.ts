import { z } from "zod";
import type { Repo } from "@/lib/db/repo";

const level = z.number().positive().finite().nullable();
export const levelsBodySchema = z.object({ manualSupport: level, manualResistance: level }).strict();

export interface ApiResult {
  status: number;
  body: unknown;
}

export async function handleLevelsPut(repo: Repo, key: string, body: unknown): Promise<ApiResult> {
  const parsed = levelsBodySchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "invalid_body" } };
  const inst = await repo.getInstrumentByKey(key);
  if (!inst) return { status: 404, body: { error: "not_found" } };
  await repo.setManualLevels(inst.id, parsed.data.manualSupport, parsed.data.manualResistance);
  return { status: 200, body: await repo.getLevels(inst.id) };
}
