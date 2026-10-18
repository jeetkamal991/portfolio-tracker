import { initialState, type AlertCondition, type Snapshot } from "@/lib/calc/alerts";
import type { Repo } from "@/lib/db/repo";
import type { StoredDay } from "@/lib/db/types";

/** A stored day as an alert snapshot: price = close. */
export function snapshotFromDay(key: string, day: StoredDay | null, at: Date): Snapshot {
  return {
    key,
    price: day?.close ?? null,
    ema20: day?.ema20 ?? null,
    ema50: day?.ema50 ?? null,
    ema200: day?.ema200 ?? null,
    rsi14: day?.rsi14 ?? null,
    score: day?.score ?? null,
    scoreLabel: day?.scoreLabel ?? null,
    at,
    live: false,
  };
}

/** Snapshots from each instrument's latest stored day. */
export function latestDaySnapshots(repo: Repo, now: Date) {
  return async (instrumentId: number): Promise<Snapshot | null> => {
    const day = await repo.getLatestDay(instrumentId);
    return day ? snapshotFromDay("", day, now) : null;
  };
}

const HOLDING_RULES: { condition: AlertCondition; level: "stopLoss" | "target1" }[] = [
  { condition: "holding_sl", level: "stopLoss" },
  { condition: "holding_target", level: "target1" },
];

/**
 * Make the `holding` rules match the holdings: one repeat rule per set SL / Target 1, value updated in place
 * when it moves (level re-initialised from the snapshot, never fired), removed when cleared or no longer held.
 */
export async function syncHoldingAlerts(repo: Repo, snapshotFor: (instrumentId: number) => Promise<Snapshot | null>): Promise<void> {
  const [holdings, rules] = await Promise.all([
    repo.listHoldings(),
    repo.listAlertRules({ conditions: HOLDING_RULES.map((r) => r.condition) }),
  ]);
  const existing = new Map(rules.filter((r) => r.source === "holding").map((r) => [`${r.instrumentId}:${r.condition}`, r]));
  const keep = new Set<number>();
  const updates: Parameters<Repo["saveAlertStates"]>[0] = [];

  for (const h of holdings) {
    for (const { condition, level } of HOLDING_RULES) {
      const value = h[level];
      if (value === null) continue;
      const rule = existing.get(`${h.instrumentId}:${condition}`);
      if (rule && rule.value === value) {
        keep.add(rule.id);
        continue;
      }
      const snap = await snapshotFor(h.instrumentId);
      const lastLevel = snap ? initialState(condition, value, snap).level : null;
      if (rule) {
        keep.add(rule.id);
        updates.push({ id: rule.id, lastState: null, lastLevel, value });
      } else {
        await repo.createAlertRule({ instrumentId: h.instrumentId, condition, value, mode: "repeat", source: "holding", lastState: null, lastLevel });
      }
    }
  }
  await repo.saveAlertStates(updates);
  for (const r of existing.values()) if (!keep.has(r.id)) await repo.deleteAlertRule(r.id);
}
