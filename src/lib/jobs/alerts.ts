import { alertMessage, CONDITIONS, evaluateRule, initialState, type AlertCondition, type Snapshot } from "@/lib/calc/alerts";
import type { Repo } from "@/lib/db/repo";
import type { AlertRule, AlertStateUpdate, NewAlertEvent, StoredDay } from "@/lib/db/types";
import type { Sender } from "@/lib/notify/telegram";
import { loadStages } from "@/lib/api/stages";
import type { StageResult } from "@/lib/calc/stage";
import { istDate } from "@/lib/time/ist";

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

export const INTRADAY_CONDITIONS = CONDITIONS.filter((c) => c.intraday).map((c) => c.id);

export interface AlertRunDeps {
  repo: Repo;
  send: Sender;
  now: Date;
  mode: "eod" | "intraday";
  /** Intraday: live prices by Yahoo ticker. */
  quotes?: Record<string, { price: number }>;
  /** Already-loaded rules (the quotes route reads them once to pick tickers); inactive ones are ignored. */
  rules?: AlertRule[];
}

/** Each instrument's latest stored day: the latest Nifty session in one query, then each straggler's own latest. */
async function latestDays(repo: Repo, ids: number[]): Promise<Map<number, StoredDay | null>> {
  const nifty = await repo.getInstrumentByKey("NIFTY50");
  const niftyDay = nifty ? await repo.getLatestDay(nifty.id) : null;
  const onSession = niftyDay ? await repo.getDaysOn(ids, niftyDay.date) : new Map<number, StoredDay>();
  const pairs = await Promise.all(ids.map(async (id) => [id, onSession.get(id) ?? (await repo.getLatestDay(id))] as const));
  return new Map(pairs);
}

/**
 * Evaluate the active rules against stored days (`eod`) or live quotes (`intraday`, price and holding rules only),
 * save every known state in one write, send each fired message to Telegram in parallel, then store the events
 * with their Telegram status. A rule with missing data is skipped and keeps its state.
 */
export async function runAlerts(deps: AlertRunDeps): Promise<{ evaluated: number; fired: number; telegramFailed: number }> {
  const { repo, now, mode } = deps;
  const loaded = deps.rules ?? (await repo.listAlertRules({ activeOnly: true, ...(mode === "intraday" && { conditions: INTRADAY_CONDITIONS }) }));
  const rules = loaded.filter((r) => r.active && (mode === "eod" || INTRADAY_CONDITIONS.includes(r.condition)));

  const snapshots = new Map<number, Snapshot | null>();
  let stages = new Map<number, StageResult>();
  if (mode === "eod") {
    const days = await latestDays(repo, [...new Set(rules.map((r) => r.instrumentId))]);
    // weekly history is read only for instruments that have a stage rule
    stages = await loadStages(repo, rules.filter((r) => r.condition === "enters_stage2").map((r) => r.instrumentId), istDate(now));
    for (const [id, day] of days) snapshots.set(id, day ? snapshotFromDay("", day, now) : null);
  }
  const snapshotOf = (r: AlertRule): Snapshot | null => {
    if (mode === "eod") {
      const s = snapshots.get(r.instrumentId);
      const stage = stages.get(r.instrumentId);
      return s ? { ...s, key: r.key, ...(stage && { stage }) } : null;
    }
    const q = deps.quotes?.[r.yahooTicker];
    if (!q) return null;
    return { key: r.key, price: q.price, ema20: null, ema50: null, ema200: null, rsi14: null, score: null, scoreLabel: null, at: now, live: true };
  };

  let evaluated = 0;
  const updates: AlertStateUpdate[] = [];
  const fired: { rule: AlertRule; snap: Snapshot; message: string }[] = [];
  for (const r of rules) {
    const snap = snapshotOf(r);
    if (!snap) continue;
    const ev = evaluateRule(
      { condition: r.condition, value: r.value, mode: r.mode, lastState: r.lastState, lastLevel: r.lastLevel, lastFiredAt: r.lastFiredAt ? new Date(r.lastFiredAt) : null },
      snap,
      {},
    );
    if (!ev.known) continue;
    evaluated++;
    const update: AlertStateUpdate = { id: r.id, lastState: ev.state, lastLevel: ev.level };
    if (ev.fire) {
      update.lastFiredAt = now.toISOString();
      if (r.mode === "once") update.active = false;
      fired.push({ rule: r, snap, message: alertMessage(r.key, r.condition, ev, snap, r.value) });
    }
    // Unchanged rules are not rewritten (the intraday pass runs every minute).
    if (ev.fire || ev.state !== r.lastState || ev.level !== r.lastLevel) updates.push(update);
  }
  await repo.saveAlertStates(updates);

  const statuses = await Promise.allSettled(fired.map((f) => deps.send(f.message)));
  const events: NewAlertEvent[] = fired.map((f, i) => {
    const s = statuses[i]!;
    return {
      alertId: f.rule.id,
      instrumentId: f.rule.instrumentId,
      firedAt: now.toISOString(),
      price: f.snap.price,
      message: f.message,
      telegramStatus: s.status === "fulfilled" ? s.value : `failed: ${String(s.reason)}`.slice(0, 200),
    };
  });
  if (events.length > 0) await repo.insertAlertEvents(events);
  return { evaluated, fired: events.length, telegramFailed: events.filter((e) => e.telegramStatus?.startsWith("failed")).length };
}
