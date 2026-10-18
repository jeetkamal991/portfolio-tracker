import { type HoldingInput, validateHoldingInput } from "@/lib/calc/portfolio";
import { swingLevelList } from "@/lib/calc/swing";
import type { ScoreLabel } from "@/lib/calc/score";
import type { Repo } from "@/lib/db/repo";
import type { Holding, Instrument, StoredDay } from "@/lib/db/types";
import { addHolding, type BackfillDeps } from "@/lib/jobs/backfill";
import { istDate } from "@/lib/time/ist";
import { primarySector } from "@/lib/universe/sectors";
import type { ApiResult } from "./levels";

const SWING_BARS = 120;

export interface PrefillData {
  key: string;
  name: string;
  sectorName: string | null;
  cmp: number | null;
  dayPct: number | null;
  score: number | null;
  scoreLabel: ScoreLabel | null;
  support: number | null;
  resistance: number | null;
  nextResistance: number | null;
  held: HoldingInput | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function validate(repo: Repo, inst: Instrument, input: unknown, now: Date) {
  const latest = await repo.getLatestDay(inst.id);
  return validateHoldingInput(input, { today: istDate(now), cmp: latest?.close ?? null });
}

export async function handleHoldingPost(deps: BackfillDeps, body: unknown): Promise<ApiResult> {
  if (!isObject(body) || typeof body.key !== "string" || body.key === "") {
    return { status: 400, body: { errors: { key: "Pick a stock" } } };
  }
  const inst = await deps.repo.getInstrumentByKey(body.key);
  if (!inst || inst.type !== "stock") return { status: 400, body: { error: "Unknown stock" } };

  const v = await validate(deps.repo, inst, body, deps.now);
  if (!v.ok) return { status: 400, body: { errors: v.errors } };
  const r = await addHolding(deps, inst.key, v.value);
  if (!r.ok) {
    return { status: 400, body: { error: r.error === "no_data" ? "No price data for this stock" : "Unknown stock" } };
  }
  return { status: 200, body: { ok: true, merged: r.merged, warnings: v.warnings } };
}

/** Replace a holding's values exactly (no merge). */
export async function handleHoldingPut(deps: Pick<BackfillDeps, "repo" | "now">, key: string, body: unknown): Promise<ApiResult> {
  const inst = await deps.repo.getInstrumentByKey(key);
  if (!inst || !(await deps.repo.getHolding(inst.id))) return { status: 404, body: { error: "not_found" } };
  const v = await validate(deps.repo, inst, body, deps.now);
  if (!v.ok) return { status: 400, body: { errors: v.errors } };
  await deps.repo.upsertHolding(inst.id, v.value);
  return { status: 200, body: { ok: true, warnings: v.warnings } };
}

export async function handleHoldingDelete(deps: Pick<BackfillDeps, "repo">, key: string): Promise<ApiResult> {
  const inst = await deps.repo.getInstrumentByKey(key);
  if (inst) await deps.repo.deleteHolding(inst.id);
  return { status: 204, body: null };
}

export async function handleHoldingPrefill(repo: Repo, key: string): Promise<ApiResult> {
  const inst = await repo.getInstrumentByKey(key);
  if (!inst || inst.type !== "stock") return { status: 404, body: { error: "not_found" } };

  const [latest, bars, memberships, held] = await Promise.all([
    repo.getLatestDay(inst.id),
    repo.getPriceBars(inst.id, SWING_BARS),
    repo.listMemberships(),
    repo.getHolding(inst.id),
  ]);
  const sectorKey = primarySector(memberships.filter((m) => m.instrumentId === inst.id).map((m) => m.indexKey));
  const sector = sectorKey ? await repo.getInstrumentByKey(sectorKey) : null;

  const cmp = latest?.close ?? null;
  let levels = { supports: [] as number[], resistances: [] as number[] };
  if (cmp !== null) {
    const priced: { high: number; low: number }[] = [];
    for (const b of bars) if (b.high !== null && b.low !== null && b.close !== null) priced.push({ high: b.high, low: b.low });
    levels = swingLevelList(priced, cmp);
  }
  const data: PrefillData = {
    key: inst.key,
    name: inst.name,
    sectorName: sector?.name ?? null,
    cmp,
    dayPct: latest ? (latest.pctChange ?? latest.importedPct) : null,
    score: latest?.score ?? null,
    scoreLabel: latest?.scoreLabel ?? null,
    support: levels.supports[0] ?? null,
    resistance: levels.resistances[0] ?? null,
    nextResistance: levels.resistances[1] ?? null,
    held: held
      ? { qty: held.qty, avgPrice: held.avgPrice, buyDate: held.buyDate, stopLoss: held.stopLoss, target1: held.target1, target2: held.target2 }
      : null,
  };
  return { status: 200, body: data };
}

/**
 * Holdings with each one's latest stored day, shared by the Portfolio tab and the Dashboard snapshot so their totals match.
 * The latest Nifty session first (one query), then each straggler's own latest.
 */
export async function loadHoldingsLatest(repo: Repo): Promise<{ holdings: Holding[]; latest: [number, StoredDay | null][] }> {
  const holdings = await repo.listHoldings();
  if (holdings.length === 0) return { holdings, latest: [] };
  const nifty = await repo.getInstrumentByKey("NIFTY50");
  const niftyDay = nifty ? await repo.getLatestDay(nifty.id) : null;
  const ids = holdings.map((h) => h.instrumentId);
  const onSession = niftyDay ? await repo.getDaysOn(ids, niftyDay.date) : new Map<number, StoredDay>();
  const latest = await Promise.all(
    ids.map(async (id): Promise<[number, StoredDay | null]> => [id, onSession.get(id) ?? (await repo.getLatestDay(id))]),
  );
  return { holdings, latest };
}
