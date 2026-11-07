import { z } from "zod";
import type { Repo } from "@/lib/db/repo";

const level = z.number().positive().finite().nullable();
export const levelsBodySchema = z.object({ manualSupport: level, manualResistance: level }).strict();

const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
export const resultsDateBodySchema = z.object({ date: z.string().refine(validDate).nullable() }).strict();

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

export async function handleResultsDatePut(repo: Repo, key: string, body: unknown): Promise<ApiResult> {
  const parsed = resultsDateBodySchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "invalid_body" } };
  const inst = await repo.getInstrumentByKey(key);
  if (!inst) return { status: 404, body: { error: "not_found" } };
  await repo.setResultsDate(inst.id, parsed.data.date);
  return { status: 200, body: { date: parsed.data.date } };
}
