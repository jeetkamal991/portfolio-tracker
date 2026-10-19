import { z } from "zod";
import { CONDITIONS, initialState, type AlertCondition } from "@/lib/calc/alerts";
import type { Repo } from "@/lib/db/repo";
import type { ScoreLabel } from "@/lib/calc/score";
import type { AlertRule, Instrument } from "@/lib/db/types";
import { snapshotFromDay } from "@/lib/jobs/alerts";
import type { Quote } from "@/lib/provider/types";
import { isMarketOpen } from "@/lib/time/ist";
import type { ApiResult } from "./levels";

const EVENTS_LIMIT = 100;
const FEED_LIMIT = 5;

const userConditions = CONDITIONS.filter((c) => c.userCreatable).map((c) => c.id) as [AlertCondition, ...AlertCondition[]];
const needsValue = new Set(CONDITIONS.filter((c) => c.needsValue).map((c) => c.id));
const intraday = new Set(CONDITIONS.filter((c) => c.intraday).map((c) => c.id));

export const alertCreateSchema = z
  .object({
    key: z.string().min(1),
    condition: z.enum(userConditions),
    value: z.number().positive().finite().nullable().optional(),
    mode: z.enum(["once", "repeat"]),
  })
  .refine((b) => !needsValue.has(b.condition) || (b.value ?? null) !== null, { path: ["value"], message: "Enter a price" });

const patchSchema = z.object({ active: z.boolean() }).strict();
const readSchema = z.union([z.object({ ids: z.array(z.number().int()) }).strict(), z.object({ all: z.literal(true) }).strict()]);

export interface AlertsData {
  rules: AlertRule[];
  events: Awaited<ReturnType<Repo["listAlertEvents"]>>;
  telegram: "connected" | "not_configured";
}

export async function handleAlertsList(repo: Repo, telegramConfigured: boolean): Promise<ApiResult & { body: AlertsData }> {
  const [rules, events] = await Promise.all([repo.listAlertRules(), repo.listAlertEvents(EVENTS_LIMIT)]);
  return { status: 200, body: { rules, events, telegram: telegramConfigured ? "connected" : "not_configured" } };
}

/**
 * New user rule. Its state is taken from the latest stored day (the live price for price rules while the market
 * is open) and stored without firing; `alreadyTrue` lets the form say it will fire the next time it becomes true.
 */
export async function handleAlertCreate(
  deps: { repo: Repo; now: Date; quotes: { get(tickers: string[]): Promise<Quote[]> } },
  body: unknown,
): Promise<ApiResult> {
  const parsed = alertCreateSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, body: { errors: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "body", i.message])) } };
  }
  const { key, condition, mode } = parsed.data;
  const value = needsValue.has(condition) ? parsed.data.value! : null;
  const inst = await deps.repo.getInstrumentByKey(key);
  if (!inst) return { status: 404, body: { error: "not_found" } };

  const snap = snapshotFromDay(inst.key, await deps.repo.getLatestDay(inst.id), deps.now);
  if (intraday.has(condition) && isMarketOpen(deps.now)) {
    try {
      const q = (await deps.quotes.get([inst.yahooTicker])).find((x) => x.ticker === inst.yahooTicker);
      if (q) snap.price = q.price;
    } catch {
      // keep the stored close
    }
  }
  const { state, level } = initialState(condition, value, snap);
  const rule = await deps.repo.createAlertRule({ instrumentId: inst.id, condition, value, mode, source: "user", lastState: state, lastLevel: level });
  return { status: 201, body: { rule, alreadyTrue: state === true } };
}

async function userRule(repo: Repo, id: string): Promise<AlertRule | ApiResult> {
  const n = Number(id);
  const rule = Number.isInteger(n) ? (await repo.listAlertRules()).find((r) => r.id === n) : undefined;
  if (!rule) return { status: 404, body: { error: "not_found" } };
  if (rule.source === "holding") return { status: 409, body: { error: "managed_by_portfolio" } };
  return rule;
}

export async function handleAlertPatch(repo: Repo, id: string, body: unknown): Promise<ApiResult> {
  const rule = await userRule(repo, id);
  if ("status" in rule) return rule;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "invalid_body" } };
  await repo.setAlertActive(rule.id, parsed.data.active);
  return { status: 200, body: { ...rule, active: parsed.data.active } };
}

export async function handleAlertDelete(repo: Repo, id: string): Promise<ApiResult> {
  const rule = await userRule(repo, id);
  if ("status" in rule) return rule;
  await repo.deleteAlertRule(rule.id);
  return { status: 204, body: null };
}

export async function handleAlertFeed(repo: Repo): Promise<ApiResult> {
  const [unread, latest] = await Promise.all([repo.unreadAlertCount(), repo.listAlertEvents(FEED_LIMIT)]);
  return { status: 200, body: { unread, latest } };
}

export async function handleAlertRead(repo: Repo, body: unknown): Promise<ApiResult> {
  const parsed = readSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "invalid_body" } };
  await repo.markAlertsRead("all" in parsed.data ? "all" : parsed.data.ids);
  return { status: 204, body: null };
}

export interface AlertSnapshot {
  key: string;
  name: string;
  type: Instrument["type"];
  date: string | null;
  price: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  score: number | null;
  scoreLabel: ScoreLabel | null;
}

/** The form's "where it is now" line: the latest stored day only (no history). */
export async function handleAlertSnapshot(repo: Repo, key: string): Promise<ApiResult> {
  const inst = await repo.getInstrumentByKey(key);
  if (!inst) return { status: 404, body: { error: "not_found" } };
  const d = await repo.getLatestDay(inst.id);
  const body: AlertSnapshot = {
    key: inst.key, name: inst.name, type: inst.type, date: d?.date ?? null, price: d?.close ?? null,
    ema20: d?.ema20 ?? null, ema50: d?.ema50 ?? null, ema200: d?.ema200 ?? null, rsi14: d?.rsi14 ?? null,
    score: d?.score ?? null, scoreLabel: d?.scoreLabel ?? null,
  };
  return { status: 200, body };
}
